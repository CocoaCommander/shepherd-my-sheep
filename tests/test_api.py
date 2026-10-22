"""
End-to-end tests for the GraphQL API: authentication, per-user
authorization, and the response shape GraphQL clients depend on.

These need the API running (docker compose up) and are skipped when it
is not reachable. Every user they create is deleted afterwards, along
with the people assigned to those users.
"""

import json
import os
import re
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

import pytest

API_HOST = os.getenv("API_HOST")
API_PORT = os.getenv("API_PORT")
if not API_HOST or not API_PORT:
    pytest.skip("API_HOST / API_PORT not set", allow_module_level=True)

# 0.0.0.0 and :: are bind addresses, not somewhere to connect to. Other
# IPv6 literals need brackets in a URL.
if API_HOST in ("0.0.0.0", "::"):
    _connect_host = "localhost"
elif ":" in API_HOST:
    _connect_host = f"[{API_HOST}]"
else:
    _connect_host = API_HOST
GRAPHQL_URL = f"http://{_connect_host}:{API_PORT}/graphql"

try:
    urllib.request.urlopen(f"http://{_connect_host}:{API_PORT}/health", timeout=2)
except OSError:
    pytest.skip(f"API not reachable at {GRAPHQL_URL}", allow_module_level=True)


# ── Helpers ──────────────────────────────────────────────────


def post_with_headers(query, variables=None, token=None):
    """Returns (http_status, headers, body)."""
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    request = urllib.request.Request(GRAPHQL_URL, data=body, method="POST")
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.headers, json.loads(response.read())
    except urllib.error.HTTPError as e:
        return e.code, e.headers, json.loads(e.read())


def post(query, variables=None, token=None):
    """Returns (http_status, body)."""
    status, _, body = post_with_headers(query, variables, token)
    return status, body


def gql(query, variables=None, token=None):
    """Data for a request that must succeed."""
    status, body = post(query, variables, token)
    assert status == 200, body
    assert not body.get("errors"), body["errors"]
    return body["data"]


def pick(obj, shape):
    """
    The fields of `obj` named in `shape`, recursively. The executor returns
    every field it loaded rather than only the selected ones, so tests
    compare the parts they asked for.
    """
    if isinstance(shape, dict):
        return {k: pick(obj[k], v) for k, v in shape.items()}
    return obj


def gql_error(query, variables=None, token=None):
    """Error message for a request that must fail with a GraphQL error."""
    status, body = post(query, variables, token)
    assert status == 200, body
    assert body.get("errors"), f"expected an error, got {body}"
    return body["errors"][0]["message"]


def gql_error_full(query, variables=None, token=None):
    """The whole first error (message, extensions) of a request that must fail with HTTP 200."""
    status, body = post(query, variables, token)
    assert status == 200, body
    assert body.get("errors"), f"expected an error, got {body}"
    return body["errors"][0]


REGISTER = """
mutation Register($input: RegisterInput!) {
  register(input: $input) { token user { __typename id name username } }
}"""

LOGIN = """
mutation Login($input: LoginInput!) {
  login(input: $input) { token user { id username } }
}"""

CREATE_PERSON = """
mutation CreatePerson($input: CreatePersonInput!) {
  createPerson(input: $input) { id name status { id name } }
}"""

PERSON = """
query Person($id: UUID!) {
  person(id: $id) {
    __typename id name age yearMet isActive
    status { name }
    shepherds { id }
    milestones { id milestone { name } recordedBy { id } }
    prayerBurdens { id content releasedDate }
    comments { id content author { id } prayerBurden { id } }
  }
}"""

UPDATE_PERSON = """
mutation UpdatePerson($id: UUID!, $input: UpdatePersonInput!) {
  updatePerson(id: $id, input: $input) { id name age yearMet isActive status { name } }
}"""

MY_PEOPLE = "query MyPeople { myPeople { id name } }"

CREATE_BURDEN = """
mutation CreatePrayerBurden($input: CreatePrayerBurdenInput!) {
  createPrayerBurden(input: $input) { id content releasedDate }
}"""

CREATE_COMMENT = """
mutation CreateComment($input: CreateCommentInput!) {
  createComment(input: $input) { id content author { id } prayerBurden { id } }
}"""

ACTIVE_BURDENS = """
query ActivePrayerBurdens($personId: UUID) {
  activePrayerBurdens(personId: $personId) { id }
}"""


@pytest.fixture()
def make_user(db_connection):
    """Registers throwaway users; returns (token, user_id) for each."""
    created = []

    def _make(password="correct-horse", name="API Test"):
        username = f"apitest_{uuid.uuid4().hex[:12]}"
        data = gql(REGISTER, {"input": {"name": name, "username": username, "password": password}})
        created.append(data["register"]["user"]["id"])
        return data["register"]["token"], data["register"]["user"]["id"], username

    yield _make

    with db_connection.cursor() as cur:
        cur.execute(
            "DELETE FROM person WHERE id IN (SELECT person_id FROM user_person WHERE user_id = ANY(%s::uuid[]))",
            (created,),
        )
        cur.execute('DELETE FROM "user" WHERE id = ANY(%s::uuid[])', (created,))


@pytest.fixture()
def status_id(db_connection):
    with db_connection.cursor() as cur:
        cur.execute("SELECT id FROM status WHERE name = 'active'")
        return str(cur.fetchone()[0])


def create_person(token, status_id, name="Alice"):
    data = gql(CREATE_PERSON, {"input": {"name": name, "statusId": status_id}}, token)
    return data["createPerson"]["id"]


# ── Authentication ───────────────────────────────────────────


class TestAuthentication:
    def test_query_without_token_is_401(self):
        status, body = post(MY_PEOPLE)
        assert status == 401
        assert body["errors"][0]["extensions"]["code"] == "UNAUTHENTICATED"

    def test_garbage_token_is_401(self):
        status, _ = post(MY_PEOPLE, token="not.a.jwt")
        assert status == 401

    def test_lookups_need_a_token_too(self):
        status, _ = post("query { statuses { id } }")
        assert status == 401

    def test_register_then_me(self, make_user):
        token, user_id, username = make_user()
        me = gql("query Me { me { id username } }", token=token)["me"]
        assert pick(me, {"id": 0, "username": 0}) == {"id": user_id, "username": username}

    def test_login_returns_working_token(self, make_user):
        _, user_id, username = make_user(password="s3cret-pass")
        data = gql(LOGIN, {"input": {"username": username, "password": "s3cret-pass"}})
        assert data["login"]["user"]["id"] == user_id
        gql(MY_PEOPLE, token=data["login"]["token"])

    def test_login_does_not_reveal_which_usernames_exist(self, make_user):
        _, _, username = make_user()
        wrong_password = gql_error(LOGIN, {"input": {"username": username, "password": "nope-nope"}})
        # A fresh name each run: failures for one username back off.
        no_such = f"no_such_user_{uuid.uuid4().hex[:12]}"
        no_such_user = gql_error(LOGIN, {"input": {"username": no_such, "password": "nope-nope"}})
        assert wrong_password == no_such_user == "Invalid username or password"

    def test_duplicate_username(self, make_user):
        _, _, username = make_user()
        message = gql_error(REGISTER, {"input": {"name": "X", "username": username, "password": "long-enough"}})
        assert message == "Username is already taken"

    def test_short_password_rejected(self):
        message = gql_error(REGISTER, {"input": {"name": "X", "username": "apitest_short", "password": "short"}})
        assert "at least 8" in message


# ── Response shape ───────────────────────────────────────────


class TestResponseShape:
    def test_data_is_keyed_by_root_field(self, make_user):
        token, _, _ = make_user()
        status, body = post(MY_PEOPLE, token=token)
        assert status == 200
        assert body["data"] == {"myPeople": []}

    def test_alias_is_used_as_response_key(self, make_user):
        token, _, _ = make_user()
        data = gql("query { mine: myPeople { id } }", token=token)
        assert data == {"mine": []}

    def test_objects_carry_typename(self, make_user):
        token, _, _ = make_user()
        statuses = gql("query { statuses { id name } }", token=token)["statuses"]
        assert statuses and all(s["__typename"] == "Status" for s in statuses)


# ── People ───────────────────────────────────────────────────


class TestPeople:
    def test_new_user_has_no_people(self, make_user):
        token, _, _ = make_user()
        assert gql(MY_PEOPLE, token=token)["myPeople"] == []

    def test_creator_is_assigned(self, make_user, status_id):
        token, user_id, _ = make_user()
        person_id = create_person(token, status_id)

        assert [p["id"] for p in gql(MY_PEOPLE, token=token)["myPeople"]] == [person_id]

        person = gql(PERSON, {"id": person_id}, token)["person"]
        assert person["__typename"] == "Person"
        assert person["status"]["name"] == "active"
        assert [s["id"] for s in person["shepherds"]] == [user_id]

    def test_new_person_has_empty_lists_not_null(self, make_user, status_id):
        token, _, _ = make_user()
        person = gql(PERSON, {"id": create_person(token, status_id)}, token)["person"]
        assert person["milestones"] == []
        assert person["prayerBurdens"] == []
        assert person["comments"] == []

    def test_comment_on_create_is_a_standalone_note_by_the_creator(self, make_user, status_id):
        token, user_id, _ = make_user()
        created = gql(
            CREATE_PERSON, {"input": {"name": "Met", "statusId": status_id, "comment": " Met at the BBQ "}}, token
        )["createPerson"]
        person = gql(PERSON, {"id": created["id"]}, token)["person"]
        assert [pick(c, {"content": 0, "author": {"id": 0}, "prayerBurden": 0}) for c in person["comments"]] == [
            {"content": "Met at the BBQ", "author": {"id": user_id}, "prayerBurden": None}
        ]

    @pytest.mark.parametrize("comment", [None, "", "   "])
    def test_no_comment_on_create_adds_none(self, make_user, status_id, comment):
        token, _, _ = make_user()
        created = gql(CREATE_PERSON, {"input": {"name": "Met", "statusId": status_id, "comment": comment}}, token)
        person = gql(PERSON, {"id": created["createPerson"]["id"]}, token)["person"]
        assert person["comments"] == []

    def test_update_accepts_numbers_and_booleans(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        updated = gql(
            """mutation UpdatePerson($id: UUID!, $input: UpdatePersonInput!) {
                 updatePerson(id: $id, input: $input) { age yearMet isActive name }
               }""",
            {"id": person_id, "input": {"age": 34, "yearMet": 2024, "isActive": False}},
            token,
        )["updatePerson"]
        assert pick(updated, {"age": 0, "yearMet": 0, "isActive": 0, "name": 0}) == {
            "age": 34,
            "yearMet": 2024,
            "isActive": False,
            "name": "Alice",
        }

    def test_update_with_age_null_clears_age_only(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        gql(UPDATE_PERSON, {"id": person_id, "input": {"age": 34, "yearMet": 2024}}, token)
        updated = gql(UPDATE_PERSON, {"id": person_id, "input": {"age": None}}, token)["updatePerson"]
        assert pick(updated, {"age": 0, "yearMet": 0}) == {"age": None, "yearMet": 2024}
        assert pick(gql(PERSON, {"id": person_id}, token)["person"], {"age": 0, "yearMet": 0}) == {
            "age": None,
            "yearMet": 2024,
        }

    def test_update_with_year_met_null_clears_year_met_only(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        gql(UPDATE_PERSON, {"id": person_id, "input": {"age": 34, "yearMet": 2024}}, token)
        updated = gql(UPDATE_PERSON, {"id": person_id, "input": {"yearMet": None}}, token)["updatePerson"]
        assert pick(updated, {"age": 0, "yearMet": 0}) == {"age": 34, "yearMet": None}

    def test_update_can_clear_age_and_year_met_together(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        gql(UPDATE_PERSON, {"id": person_id, "input": {"age": 34, "yearMet": 2024}}, token)
        updated = gql(UPDATE_PERSON, {"id": person_id, "input": {"age": None, "yearMet": None}}, token)
        assert pick(updated["updatePerson"], {"age": 0, "yearMet": 0}) == {"age": None, "yearMet": None}

    def test_update_with_key_absent_leaves_value_unchanged(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        gql(UPDATE_PERSON, {"id": person_id, "input": {"age": 34, "yearMet": 2024}}, token)
        updated = gql(UPDATE_PERSON, {"id": person_id, "input": {"name": "Renamed"}}, token)["updatePerson"]
        assert pick(updated, {"name": 0, "age": 0, "yearMet": 0}) == {"name": "Renamed", "age": 34, "yearMet": 2024}

    @pytest.mark.parametrize(
        "field, message",
        [
            ("name", "Name can't be cleared"),
            ("isActive", "Active can't be cleared"),
            ("statusId", "Status can't be cleared"),
        ],
    )
    def test_update_cannot_clear_required_fields(self, make_user, status_id, field, message):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        gql(UPDATE_PERSON, {"id": person_id, "input": {"age": 34, "yearMet": 2024}}, token)
        shape = {"name": 0, "age": 0, "yearMet": 0, "isActive": 0, "status": {"name": 0}}
        before = pick(gql(PERSON, {"id": person_id}, token)["person"], shape)

        error = gql_error_full(UPDATE_PERSON, {"id": person_id, "input": {field: None, "age": 50}}, token)
        assert error["message"] == message
        assert error["extensions"]["code"] == "BAD_USER_INPUT"

        assert pick(gql(PERSON, {"id": person_id}, token)["person"], shape) == before

    def test_clearing_on_a_bare_person_leaves_contact_clock_alone(self, make_user, status_id):
        """No contacts, milestones or burdens: clearing is still fine and does not touch the clock."""
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        query = PERSON.replace("isActive", "isActive contactState contactClockStart")
        gql(UPDATE_PERSON, {"id": person_id, "input": {"age": 34, "yearMet": 2024}}, token)
        before = gql(query, {"id": person_id}, token)["person"]

        updated = gql(UPDATE_PERSON, {"id": person_id, "input": {"age": None, "yearMet": None}}, token)
        assert pick(updated["updatePerson"], {"age": 0, "yearMet": 0}) == {"age": None, "yearMet": None}

        after = gql(query, {"id": person_id}, token)["person"]
        assert after["contactState"] == before["contactState"]
        assert after["contactClockStart"] == before["contactClockStart"]
        assert after["milestones"] == after["prayerBurdens"] == after["comments"] == []

    # Regression: "unassignPerson" used to route to assignPerson.
    def test_unassign_removes_shepherd(self, make_user, status_id):
        token, _, _ = make_user()
        _, other_id, _ = make_user()
        person_id = create_person(token, status_id)

        assigned = gql(
            """mutation AssignPerson($personId: UUID!, $userId: UUID!) {
                 assignPerson(personId: $personId, userId: $userId) { shepherds { id } }
               }""",
            {"personId": person_id, "userId": other_id},
            token,
        )["assignPerson"]
        assert other_id in [s["id"] for s in assigned["shepherds"]]

        unassigned = gql(
            """mutation UnassignPerson($personId: UUID!, $userId: UUID!) {
                 unassignPerson(personId: $personId, userId: $userId) { shepherds { id } }
               }""",
            {"personId": person_id, "userId": other_id},
            token,
        )["unassignPerson"]
        assert other_id not in [s["id"] for s in unassigned["shepherds"]]


UNASSIGN = """
mutation UnassignPerson($personId: UUID!, $userId: UUID!) {
  unassignPerson(personId: $personId, userId: $userId) { id shepherds { id } }
}"""

ASSIGN = """
mutation AssignPerson($personId: UUID!, $userId: UUID!) {
  assignPerson(personId: $personId, userId: $userId) { id }
}"""

DELETE_PERSON = "mutation D($id: UUID!) { deletePerson(id: $id) }"

LAST_SHEPHERD = "A person needs at least one shepherd. Delete them instead."


class TestUnassignAndDelete:
    @pytest.fixture()
    def pair(self, make_user, status_id):
        """Two shepherds (a, b) of one person."""
        a_token, a_id, _ = make_user()
        b_token, b_id, _ = make_user()
        person_id = create_person(a_token, status_id)
        gql(ASSIGN, {"personId": person_id, "userId": b_id}, a_token)
        return a_token, a_id, b_token, b_id, person_id

    def test_sole_shepherd_cannot_remove_themselves(self, make_user, status_id):
        token, user_id, _ = make_user()
        person_id = create_person(token, status_id)
        error = gql_error_full(UNASSIGN, {"personId": person_id, "userId": user_id}, token)
        assert error["message"] == LAST_SHEPHERD
        assert error["extensions"]["code"] == "BAD_USER_INPUT"
        assert gql(PERSON, {"id": person_id}, token)["person"] is not None

    def test_removed_shepherd_loses_access_and_last_one_is_protected(self, pair):
        a_token, a_id, b_token, b_id, person_id = pair
        result = gql(UNASSIGN, {"personId": person_id, "userId": b_id}, a_token)["unassignPerson"]
        assert [s["id"] for s in result["shepherds"]] == [a_id]
        assert gql(PERSON, {"id": person_id}, b_token)["person"] is None
        error = gql_error_full(UNASSIGN, {"personId": person_id, "userId": a_id}, a_token)
        assert error["message"] == LAST_SHEPHERD
        assert error["extensions"]["code"] == "BAD_USER_INPUT"

    def test_shepherd_can_remove_themselves_when_others_remain(self, pair):
        a_token, a_id, b_token, b_id, person_id = pair
        gql(UNASSIGN, {"personId": person_id, "userId": a_id}, a_token)
        assert person_id not in [p["id"] for p in gql(MY_PEOPLE, token=a_token)["myPeople"]]
        assert person_id in [p["id"] for p in gql(MY_PEOPLE, token=b_token)["myPeople"]]
        assert [s["id"] for s in gql(PERSON, {"id": person_id}, b_token)["person"]["shepherds"]] == [b_id]

    def test_removing_a_non_shepherd_is_not_found(self, pair, make_user):
        a_token, _, _, _, person_id = pair
        _, outsider_id, _ = make_user()
        error = gql_error_full(UNASSIGN, {"personId": person_id, "userId": outsider_id}, a_token)
        assert error["extensions"]["code"] == "NOT_FOUND"

    def test_stranger_cannot_unassign(self, pair, make_user):
        _, a_id, _, _, person_id = pair
        stranger_token, _, _ = make_user()
        error = gql_error_full(UNASSIGN, {"personId": person_id, "userId": a_id}, stranger_token)
        assert error["extensions"]["code"] == "NOT_FOUND"
        assert error["message"] == "Person not found"

    def test_delete_removes_person_for_every_shepherd(self, pair):
        a_token, _, b_token, _, person_id = pair
        assert gql(DELETE_PERSON, {"id": person_id}, a_token)["deletePerson"] is True
        assert gql(PERSON, {"id": person_id}, b_token)["person"] is None
        assert gql(MY_PEOPLE, token=a_token)["myPeople"] == []
        assert gql(MY_PEOPLE, token=b_token)["myPeople"] == []

    def test_stranger_cannot_delete(self, pair, make_user):
        a_token, _, _, _, person_id = pair
        stranger_token, _, _ = make_user()
        error = gql_error_full(DELETE_PERSON, {"id": person_id}, stranger_token)
        assert error["extensions"]["code"] == "NOT_FOUND"
        assert gql(PERSON, {"id": person_id}, a_token)["person"] is not None


# ── Authorization: you only see and change your own people ───


class TestAuthorization:
    @pytest.fixture()
    def two_users(self, make_user, status_id):
        owner_token, owner_id, _ = make_user()
        stranger_token, _, _ = make_user()
        person_id = create_person(owner_token, status_id)
        return owner_token, owner_id, stranger_token, person_id

    def test_stranger_cannot_read_person(self, two_users):
        _, _, stranger, person_id = two_users
        assert gql(PERSON, {"id": person_id}, stranger)["person"] is None

    def test_my_people_ignores_user_id_variable(self, two_users):
        _, owner_id, stranger, _ = two_users
        assert gql(MY_PEOPLE, {"userId": owner_id}, stranger)["myPeople"] == []

    def test_stranger_cannot_update_or_delete(self, two_users, status_id):
        _, _, stranger, person_id = two_users
        assert (
            gql_error(
                "mutation U($id: UUID!, $input: UpdatePersonInput!) { updatePerson(id: $id, input: $input) { id } }",
                {"id": person_id, "input": {"name": "Hijacked"}},
                stranger,
            )
            == "Person not found"
        )
        assert (
            gql_error(
                "mutation D($id: UUID!) { deletePerson(id: $id) }",
                {"id": person_id},
                stranger,
            )
            == "Person not found"
        )

    def test_stranger_cannot_assign_themselves(self, two_users, make_user):
        _, _, stranger, person_id = two_users
        stranger_id = gql("query { me { id } }", token=stranger)["me"]["id"]
        assert (
            gql_error(
                "mutation A($personId: UUID!, $userId: UUID!) { assignPerson(personId: $personId, userId: $userId) { id } }",
                {"personId": person_id, "userId": stranger_id},
                stranger,
            )
            == "Person not found"
        )

    def test_stranger_cannot_add_burdens_or_comments(self, two_users):
        _, _, stranger, person_id = two_users
        assert (
            gql_error(CREATE_BURDEN, {"input": {"personId": person_id, "content": "x"}}, stranger) == "Person not found"
        )
        assert (
            gql_error(CREATE_COMMENT, {"input": {"personId": person_id, "content": "x"}}, stranger)
            == "Person not found"
        )

    def test_stranger_cannot_see_or_release_burdens(self, two_users):
        owner, _, stranger, person_id = two_users
        burden_id = gql(CREATE_BURDEN, {"input": {"personId": person_id, "content": "x"}}, owner)["createPrayerBurden"][
            "id"
        ]

        assert gql(ACTIVE_BURDENS, {"personId": person_id}, stranger)["activePrayerBurdens"] == []
        assert gql(ACTIVE_BURDENS, {}, stranger)["activePrayerBurdens"] == []
        assert (
            gql_error("mutation R($id: UUID!) { releasePrayerBurden(id: $id) { id } }", {"id": burden_id}, stranger)
            == "Prayer burden not found"
        )

    def test_comment_cannot_link_another_persons_burden(self, two_users, make_user, status_id):
        owner, _, stranger, person_id = two_users
        burden_id = gql(CREATE_BURDEN, {"input": {"personId": person_id, "content": "x"}}, owner)["createPrayerBurden"][
            "id"
        ]
        strangers_person = create_person(stranger, status_id, name="Bob")

        assert (
            gql_error(
                CREATE_COMMENT,
                {"input": {"personId": strangers_person, "prayerBurdenId": burden_id, "content": "x"}},
                stranger,
            )
            == "Prayer burden not found"
        )

    def test_only_author_can_delete_comment(self, two_users):
        owner, _, stranger, person_id = two_users
        comment_id = gql(CREATE_COMMENT, {"input": {"personId": person_id, "content": "x"}}, owner)["createComment"][
            "id"
        ]
        assert (
            gql_error("mutation D($id: UUID!) { deleteComment(id: $id) }", {"id": comment_id}, stranger)
            == "Comment not found"
        )
        assert gql("mutation D($id: UUID!) { deleteComment(id: $id) }", {"id": comment_id}, owner) == {
            "deleteComment": True
        }


# ── Burdens, comments, milestones ────────────────────────────


class TestPersonActivity:
    def test_comment_author_comes_from_token(self, make_user, status_id):
        token, user_id, _ = make_user()
        _, other_id, _ = make_user()
        person_id = create_person(token, status_id)

        comment = gql(
            CREATE_COMMENT,
            {"input": {"personId": person_id, "content": "Met for coffee"}, "userId": other_id},
            token,
        )["createComment"]
        assert comment["author"]["id"] == user_id
        assert comment["prayerBurden"] is None  # standalone note (rule 5)

    def test_burden_comment_link_and_release(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)

        burden_id = gql(CREATE_BURDEN, {"input": {"personId": person_id, "content": "New job"}}, token)[
            "createPrayerBurden"
        ]["id"]
        comment = gql(
            CREATE_COMMENT,
            {"input": {"personId": person_id, "prayerBurdenId": burden_id, "content": "Interview Friday"}},
            token,
        )["createComment"]
        assert comment["prayerBurden"]["id"] == burden_id

        # Regression: "personId" argument used to route this to `person`.
        active = gql(ACTIVE_BURDENS, {"personId": person_id}, token)["activePrayerBurdens"]
        assert [b["id"] for b in active] == [burden_id]

        released = gql(
            "mutation R($id: UUID!) { releasePrayerBurden(id: $id) { releasedDate } }", {"id": burden_id}, token
        )["releasePrayerBurden"]
        assert released["releasedDate"] is not None
        assert gql(ACTIVE_BURDENS, {"personId": person_id}, token)["activePrayerBurdens"] == []

        person = gql(PERSON, {"id": person_id}, token)["person"]
        assert [b["id"] for b in person["prayerBurdens"]] == [burden_id]
        assert person["comments"][0]["prayerBurden"]["id"] == burden_id

    def test_milestone_recorded_by_caller(self, make_user, status_id, db_connection):
        token, user_id, _ = make_user()
        person_id = create_person(token, status_id)
        with db_connection.cursor() as cur:
            cur.execute("SELECT id FROM milestone WHERE name = 'baptised'")
            milestone_id = str(cur.fetchone()[0])

        recorded = gql(
            """mutation RecordMilestone($input: RecordMilestoneInput!) {
                 recordMilestone(input: $input) { milestone { name } recordedBy { id } dateAchieved }
               }""",
            {"input": {"personId": person_id, "milestoneId": milestone_id, "dateAchieved": "2026-04-05"}},
            token,
        )["recordMilestone"]
        assert pick(recorded, {"milestone": {"name": 0}, "recordedBy": {"id": 0}, "dateAchieved": 0}) == {
            "milestone": {"name": "baptised"},
            "recordedBy": {"id": user_id},
            "dateAchieved": "2026-04-05",
        }


# ── Error codes ──────────────────────────────────────────────


class TestErrorCodes:
    def assert_clean(self, error):
        message = error["message"]
        assert not message.startswith("Database error"), message
        for leak in ("violates", "constraint", "syntax", "uuid"):
            assert leak not in message.lower(), message

    def test_wrong_password_is_bad_user_input(self, make_user):
        _, _, username = make_user()
        error = gql_error_full(LOGIN, {"input": {"username": username, "password": "nope-nope"}})
        assert error["extensions"]["code"] == "BAD_USER_INPUT"
        assert error["message"] == "Invalid username or password"

    def test_taken_username_is_conflict(self, make_user):
        _, _, username = make_user()
        error = gql_error_full(REGISTER, {"input": {"name": "X", "username": username, "password": "long-enough"}})
        assert error["extensions"]["code"] == "CONFLICT"
        assert error["message"] == "Username is already taken"

    def test_short_password_is_bad_user_input(self):
        error = gql_error_full(REGISTER, {"input": {"name": "X", "username": "apitest_short", "password": "short"}})
        assert error["extensions"]["code"] == "BAD_USER_INPUT"

    def test_duplicate_milestone_is_conflict(self, make_user, status_id, db_connection):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        with db_connection.cursor() as cur:
            cur.execute("SELECT id FROM milestone WHERE name = 'baptised'")
            milestone_id = str(cur.fetchone()[0])
        record = """mutation R($input: RecordMilestoneInput!) {
                      recordMilestone(input: $input) { dateAchieved }
                    }"""
        variables = {"input": {"personId": person_id, "milestoneId": milestone_id, "dateAchieved": "2026-04-05"}}
        gql(record, variables, token)
        error = gql_error_full(record, variables, token)
        assert error["extensions"]["code"] == "CONFLICT"
        assert error["message"] == "Milestone is already recorded for this person"

    def test_stranger_burden_is_not_found(self, make_user, status_id):
        owner, _, _ = make_user()
        stranger, _, _ = make_user()
        person_id = create_person(owner, status_id)
        error = gql_error_full(CREATE_BURDEN, {"input": {"personId": person_id, "content": "x"}}, stranger)
        assert error["extensions"]["code"] == "NOT_FOUND"
        assert error["message"] == "Person not found"

    def test_malformed_uuid_is_bad_user_input(self, make_user):
        token, _, _ = make_user()
        error = gql_error_full("query P($id: UUID!) { person(id: $id) { id } }", {"id": "not-a-uuid"}, token)
        assert error["extensions"]["code"] == "BAD_USER_INPUT"
        assert error["message"] == "Invalid input"
        self.assert_clean(error)

    def test_update_with_unknown_status_is_not_found(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        error = gql_error_full(
            "mutation U($id: UUID!, $input: UpdatePersonInput!) { updatePerson(id: $id, input: $input) { id } }",
            {"id": person_id, "input": {"statusId": str(uuid.uuid4())}},
            token,
        )
        assert error["extensions"]["code"] == "NOT_FOUND"
        assert error["message"] == "Not found"
        self.assert_clean(error)

    @pytest.mark.parametrize(
        "fields",
        [
            {"name": "   "},
            {"age": -1},
            {"age": 121},
            {"yearMet": 1899},
            # The server allows the year in the earliest time zone, so go one past that.
            {"yearMet": (datetime.now(timezone.utc) + timedelta(hours=14)).year + 1},
        ],
    )
    def test_invalid_person_is_bad_user_input(self, make_user, status_id, fields):
        token, _, _ = make_user()
        error = gql_error_full(CREATE_PERSON, {"input": {"name": "Alice", "statusId": status_id, **fields}}, token)
        assert error["extensions"]["code"] == "BAD_USER_INPUT"
        self.assert_clean(error)
        assert gql(MY_PEOPLE, token=token)["myPeople"] == []

    def test_blank_name_on_update_is_bad_user_input(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        error = gql_error_full(
            "mutation U($id: UUID!, $input: UpdatePersonInput!) { updatePerson(id: $id, input: $input) { id } }",
            {"id": person_id, "input": {"name": " "}},
            token,
        )
        assert error["extensions"]["code"] == "BAD_USER_INPUT"
        assert error["message"] == "Name must not be blank"

    def test_person_name_is_trimmed(self, make_user, status_id):
        token, _, _ = make_user()
        data = gql(CREATE_PERSON, {"input": {"name": "  Alice  ", "statusId": status_id}}, token)
        assert data["createPerson"]["name"] == "Alice"

    def test_overlong_name_is_bad_user_input(self, make_user, status_id):
        token, _, _ = make_user()
        error = gql_error_full(CREATE_PERSON, {"input": {"name": "x" * 101, "statusId": status_id}}, token)
        assert error["extensions"]["code"] == "BAD_USER_INPUT"
        assert error["message"] == "A value is too long"
        self.assert_clean(error)

    def test_releasing_twice_is_not_found_without_uuid(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        burden_id = gql(CREATE_BURDEN, {"input": {"personId": person_id, "content": "x"}}, token)["createPrayerBurden"][
            "id"
        ]
        release = "mutation R($id: UUID!) { releasePrayerBurden(id: $id) { id } }"
        gql(release, {"id": burden_id}, token)
        error = gql_error_full(release, {"id": burden_id}, token)
        assert error["extensions"]["code"] == "NOT_FOUND"
        assert burden_id not in error["message"]
        self.assert_clean(error)

    def test_removing_unrecorded_milestone_is_not_found(self, make_user, status_id, db_connection):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        with db_connection.cursor() as cur:
            cur.execute("SELECT id FROM milestone WHERE name = 'baptised'")
            milestone_id = str(cur.fetchone()[0])
        error = gql_error_full(
            "mutation R($personId: UUID!, $milestoneId: UUID!) { removeMilestone(personId: $personId, milestoneId: $milestoneId) }",
            {"personId": person_id, "milestoneId": milestone_id},
            token,
        )
        assert error["extensions"]["code"] == "NOT_FOUND"
        self.assert_clean(error)

    def test_unauthenticated_is_still_401(self):
        status, body = post(MY_PEOPLE)
        assert status == 401
        assert body["errors"][0]["extensions"]["code"] == "UNAUTHENTICATED"


PRAYER_LIST = """
query Q($personId: UUID) {
  activePrayerBurdens(personId: $personId) {
    id content
    person { id name status { id name } }
    comments { id content createdAt author { id name } }
  }
}"""

RELEASE_BURDEN = """
mutation R($id: UUID!) {
  releasePrayerBurden(id: $id) {
    id releasedDate
    person { id name status { id name } }
    comments { id content author { id name } }
  }
}"""

PERSON_BURDENS = """
query P($id: UUID!) {
  person(id: $id) { prayerBurdens { id releasedDate comments { id content } } }
}"""


def person_dict(person_id, name, status_id, status_name):
    return {
        "__typename": "Person",
        "id": person_id,
        "name": name,
        "status": {"__typename": "Status", "id": status_id, "name": status_name},
    }


class TestPrayerList:
    def burden(self, token, person_id, content):
        return gql(CREATE_BURDEN, {"input": {"personId": person_id, "content": content}}, token)["createPrayerBurden"][
            "id"
        ]

    def test_all_people_include_whose_burden_it_is(self, make_user, status_id):
        token, _, _ = make_user()
        alice = create_person(token, status_id, name="Alice")
        bob = create_person(token, status_id, name="Bob")
        a_burden = self.burden(token, alice, "for alice")
        b_burden = self.burden(token, bob, "for bob")

        rows = gql(PRAYER_LIST, {}, token)["activePrayerBurdens"]
        by_id = {r["id"]: r for r in rows}
        assert set(by_id) == {a_burden, b_burden}
        assert len(rows) == 2
        assert by_id[a_burden]["person"] == person_dict(alice, "Alice", status_id, "active")
        assert by_id[b_burden]["person"] == person_dict(bob, "Bob", status_id, "active")

    def test_person_filter_returns_only_that_persons_burdens(self, make_user, status_id):
        token, _, _ = make_user()
        alice = create_person(token, status_id, name="Alice")
        bob = create_person(token, status_id, name="Bob")
        a_burden = self.burden(token, alice, "for alice")
        self.burden(token, bob, "for bob")

        rows = gql(PRAYER_LIST, {"personId": alice}, token)["activePrayerBurdens"]
        assert [r["id"] for r in rows] == [a_burden]
        assert rows[0]["person"] == person_dict(alice, "Alice", status_id, "active")

    def test_released_burdens_are_excluded(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        kept = self.burden(token, person_id, "keep")
        released = self.burden(token, person_id, "release")
        gql("mutation R($id: UUID!) { releasePrayerBurden(id: $id) { id } }", {"id": released}, token)

        assert [r["id"] for r in gql(PRAYER_LIST, {}, token)["activePrayerBurdens"]] == [kept]
        assert [r["id"] for r in gql(PRAYER_LIST, {"personId": person_id}, token)["activePrayerBurdens"]] == [kept]

    def test_another_users_burdens_never_appear(self, make_user, status_id):
        owner, _, _ = make_user()
        stranger, _, _ = make_user()
        owners_person = create_person(owner, status_id, name="Alice")
        self.burden(owner, owners_person, "private")
        mine = create_person(stranger, status_id, name="Bob")
        my_burden = self.burden(stranger, mine, "mine")

        rows = gql(PRAYER_LIST, {}, stranger)["activePrayerBurdens"]
        assert [r["id"] for r in rows] == [my_burden]
        assert gql(PRAYER_LIST, {"personId": owners_person}, stranger)["activePrayerBurdens"] == []

    def test_user_with_no_people_gets_empty_list(self, make_user):
        token, _, _ = make_user()
        assert gql(PRAYER_LIST, {}, token)["activePrayerBurdens"] == []

    def test_people_without_burdens_get_empty_list(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        assert gql(PRAYER_LIST, {}, token)["activePrayerBurdens"] == []
        assert gql(PRAYER_LIST, {"personId": person_id}, token)["activePrayerBurdens"] == []


class TestPrayerBurdenComments:
    @pytest.fixture()
    def statuses(self, db_connection):
        with db_connection.cursor() as cur:
            cur.execute("SELECT name, id FROM status")
            return {name: str(id_) for name, id_ in cur.fetchall()}

    def burden(self, token, person_id, content="pray"):
        return gql(CREATE_BURDEN, {"input": {"personId": person_id, "content": content}}, token)["createPrayerBurden"][
            "id"
        ]

    def comment(self, token, person_id, content, burden_id=None):
        fields = {"personId": person_id, "content": content}
        if burden_id:
            fields["prayerBurdenId"] = burden_id
        return gql(CREATE_COMMENT, {"input": fields}, token)["createComment"]["id"]

    def rows(self, token, person_id=None):
        rows = gql(PRAYER_LIST, {"personId": person_id}, token)["activePrayerBurdens"]
        return {r["id"]: r for r in rows}

    def test_person_status_is_real_and_follows_updates(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"], name="Alice")
        burden_id = self.burden(token, person_id)
        assert self.rows(token)[burden_id]["person"] == person_dict(person_id, "Alice", statuses["active"], "active")

        gql(UPDATE_STATUS, {"id": person_id, "input": {"statusId": statuses["inactive"]}}, token)
        assert self.rows(token)[burden_id]["person"] == person_dict(
            person_id, "Alice", statuses["inactive"], "inactive"
        )

    def test_comments_newest_first_and_only_that_burdens(self, make_user, status_id):
        token, user_id, _ = make_user(name="Writer")
        person_id = create_person(token, status_id)
        burden_id = self.burden(token, person_id, "mine")
        other_id = self.burden(token, person_id, "other")
        first = self.comment(token, person_id, "first", burden_id)
        self.comment(token, person_id, "standalone note")
        self.comment(token, person_id, "on the other burden", other_id)
        second = self.comment(token, person_id, "second", burden_id)

        comments = self.rows(token)[burden_id]["comments"]
        assert [c["id"] for c in comments] == [second, first]
        assert [c["content"] for c in comments] == ["second", "first"]
        assert all(pick(c["author"], {"id": 0, "name": 0}) == {"id": user_id, "name": "Writer"} for c in comments)
        assert all(c["createdAt"] is not None for c in comments)
        assert parse_time(comments[0]["createdAt"]) >= parse_time(comments[1]["createdAt"])

    def test_burden_without_comments_has_empty_list(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        burden_id = self.burden(token, person_id)
        self.comment(token, person_id, "standalone note")

        assert self.rows(token)[burden_id]["comments"] == []

    def test_each_of_a_persons_burdens_gets_its_own_comments(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        one = self.burden(token, person_id, "one")
        two = self.burden(token, person_id, "two")
        c1 = self.comment(token, person_id, "on one", one)
        c2a = self.comment(token, person_id, "on two a", two)
        c2b = self.comment(token, person_id, "on two b", two)

        rows = self.rows(token, person_id)
        assert [c["id"] for c in rows[one]["comments"]] == [c1]
        assert [c["id"] for c in rows[two]["comments"]] == [c2b, c2a]

    def test_a_second_shepherds_comments_show_for_the_first(self, make_user, status_id):
        a_token, a_id, _ = make_user(name="Alpha")
        b_token, b_id, _ = make_user(name="Beta")
        person_id = create_person(a_token, status_id)
        burden_id = self.burden(a_token, person_id)
        gql(ASSIGN, {"personId": person_id, "userId": b_id}, a_token)
        mine = self.comment(a_token, person_id, "from alpha", burden_id)
        theirs = self.comment(b_token, person_id, "from beta", burden_id)

        for token in (a_token, b_token):
            comments = self.rows(token)[burden_id]["comments"]
            assert [(c["id"], pick(c["author"], {"id": 0, "name": 0})) for c in comments] == [
                (theirs, {"id": b_id, "name": "Beta"}),
                (mine, {"id": a_id, "name": "Alpha"}),
            ]

    def test_strangers_burdens_and_comments_never_appear(self, make_user, status_id):
        owner, _, _ = make_user()
        stranger, _, _ = make_user()
        owners_person = create_person(owner, status_id)
        owners_burden = self.burden(owner, owners_person)
        self.comment(owner, owners_person, "private", owners_burden)
        mine = create_person(stranger, status_id)
        my_burden = self.burden(stranger, mine)
        my_comment = self.comment(stranger, mine, "mine", my_burden)

        rows = self.rows(stranger)
        assert set(rows) == {my_burden}
        assert [c["id"] for c in rows[my_burden]["comments"]] == [my_comment]
        assert self.rows(stranger, owners_person) == {}

    def test_person_prayer_burdens_list_their_own_comments(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        active = self.burden(token, person_id, "active")
        released = self.burden(token, person_id, "released")
        bare = self.burden(token, person_id, "bare")
        a1 = self.comment(token, person_id, "a1", active)
        r1 = self.comment(token, person_id, "r1", released)
        r2 = self.comment(token, person_id, "r2", released)
        self.comment(token, person_id, "standalone")
        gql(RELEASE_BURDEN, {"id": released}, token)

        burdens = {b["id"]: b for b in gql(PERSON_BURDENS, {"id": person_id}, token)["person"]["prayerBurdens"]}
        assert set(burdens) == {active, released, bare}
        assert [c["id"] for c in burdens[active]["comments"]] == [a1]
        assert [c["id"] for c in burdens[released]["comments"]] == [r2, r1]
        assert burdens[released]["releasedDate"] is not None
        assert burdens[bare]["comments"] == []

    def test_person_without_burdens_has_empty_list(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        assert gql(PERSON_BURDENS, {"id": person_id}, token)["person"]["prayerBurdens"] == []

    def test_create_burden_returns_person_and_no_comments(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"], name="Alice")
        query = CREATE_BURDEN.replace("releasedDate }", "releasedDate person { id status { name } } comments { id } }")
        burden = gql(query, {"input": {"personId": person_id, "content": "new"}}, token)["createPrayerBurden"]
        assert burden["person"]["id"] == person_id
        assert burden["person"]["status"]["name"] == "active"
        assert burden["comments"] == []

    def test_release_burden_returns_comments_and_person(self, make_user, statuses):
        token, user_id, _ = make_user(name="Writer")
        person_id = create_person(token, statuses["active"], name="Alice")
        burden_id = self.burden(token, person_id)
        bare_id = self.burden(token, person_id, "bare")
        first = self.comment(token, person_id, "first", burden_id)
        second = self.comment(token, person_id, "second", burden_id)
        self.comment(token, person_id, "standalone")

        released = gql(RELEASE_BURDEN, {"id": burden_id}, token)["releasePrayerBurden"]
        assert released["releasedDate"] is not None
        assert released["person"] == person_dict(person_id, "Alice", statuses["active"], "active")
        assert [c["id"] for c in released["comments"]] == [second, first]
        assert pick(released["comments"][0]["author"], {"id": 0, "name": 0}) == {"id": user_id, "name": "Writer"}

        assert gql(RELEASE_BURDEN, {"id": bare_id}, token)["releasePrayerBurden"]["comments"] == []

    def test_burden_nested_in_comment_stays_shallow(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        burden_id = self.burden(token, person_id)
        self.comment(token, person_id, "on it", burden_id)

        [mine] = gql("query { myPeople { id latestComment { prayerBurden { id } } } }", token=token)["myPeople"]
        assert mine["latestComment"]["prayerBurden"]["id"] == burden_id

        [comment] = gql(PERSON, {"id": person_id}, token)["person"]["comments"]
        assert comment["prayerBurden"]["id"] == burden_id
        assert comment["prayerBurden"].get("comments") is None
        assert comment["prayerBurden"].get("person") is None


UNRELEASE_BURDEN = """
mutation U($id: UUID!) {
  unreleasePrayerBurden(id: $id) {
    id content releasedDate
    person { id name status { id name } }
    comments { id content author { id name } }
  }
}"""

RECENTLY_RELEASED = """
query Q($personId: UUID) {
  recentlyReleasedPrayerBurdens(personId: $personId) {
    id content releasedDate
    person { id name status { id name } }
    comments { id content createdAt author { id name } }
  }
}"""

RELEASE_ID_ONLY = "mutation R($id: UUID!) { releasePrayerBurden(id: $id) { id } }"


class TestUnreleasePrayerBurden:
    @pytest.fixture()
    def statuses(self, db_connection):
        with db_connection.cursor() as cur:
            cur.execute("SELECT name, id FROM status")
            return {name: str(id_) for name, id_ in cur.fetchall()}

    def burden(self, token, person_id, content="pray"):
        return gql(CREATE_BURDEN, {"input": {"personId": person_id, "content": content}}, token)["createPrayerBurden"][
            "id"
        ]

    def comment(self, token, person_id, content, burden_id=None):
        fields = {"personId": person_id, "content": content}
        if burden_id:
            fields["prayerBurdenId"] = burden_id
        return gql(CREATE_COMMENT, {"input": fields}, token)["createComment"]["id"]

    def test_unrelease_returns_active_burden_with_person_and_comments(self, make_user, statuses):
        token, user_id, _ = make_user(name="Writer")
        person_id = create_person(token, statuses["active"], name="Alice")
        burden_id = self.burden(token, person_id, "back again")
        first = self.comment(token, person_id, "first", burden_id)
        second = self.comment(token, person_id, "second", burden_id)
        gql(RELEASE_ID_ONLY, {"id": burden_id}, token)

        burden = gql(UNRELEASE_BURDEN, {"id": burden_id}, token)["unreleasePrayerBurden"]
        assert burden["id"] == burden_id
        assert burden["content"] == "back again"
        assert burden["releasedDate"] is None
        assert burden["person"] == person_dict(person_id, "Alice", statuses["active"], "active")
        assert [c["id"] for c in burden["comments"]] == [second, first]
        assert pick(burden["comments"][0]["author"], {"id": 0, "name": 0}) == {"id": user_id, "name": "Writer"}

    def test_unrelease_moves_burden_between_lists(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        burden_id = self.burden(token, person_id)
        comment_id = self.comment(token, person_id, "kept", burden_id)
        gql(RELEASE_ID_ONLY, {"id": burden_id}, token)
        assert gql(PRAYER_LIST, {}, token)["activePrayerBurdens"] == []
        assert [r["id"] for r in gql(RECENTLY_RELEASED, {}, token)["recentlyReleasedPrayerBurdens"]] == [burden_id]

        gql(UNRELEASE_BURDEN, {"id": burden_id}, token)

        [active] = gql(PRAYER_LIST, {}, token)["activePrayerBurdens"]
        assert active["id"] == burden_id
        assert [c["id"] for c in active["comments"]] == [comment_id]
        assert gql(RECENTLY_RELEASED, {}, token)["recentlyReleasedPrayerBurdens"] == []

    def test_burden_without_comments_unreleases_with_empty_comments(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        burden_id = self.burden(token, person_id)
        gql(RELEASE_ID_ONLY, {"id": burden_id}, token)
        assert gql(UNRELEASE_BURDEN, {"id": burden_id}, token)["unreleasePrayerBurden"]["comments"] == []

    def test_can_release_again_after_unrelease(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        burden_id = self.burden(token, person_id)
        gql(RELEASE_ID_ONLY, {"id": burden_id}, token)
        gql(UNRELEASE_BURDEN, {"id": burden_id}, token)
        assert gql(RELEASE_BURDEN, {"id": burden_id}, token)["releasePrayerBurden"]["releasedDate"] is not None

    def test_unreleasing_long_released_burden_still_works(self, make_user, status_id, db_connection):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        burden_id = self.burden(token, person_id)
        gql(RELEASE_ID_ONLY, {"id": burden_id}, token)
        with db_connection.cursor() as cur:
            cur.execute(
                "UPDATE prayer_burden SET released_date = now() - interval '1 year' WHERE id = %s", (burden_id,)
            )
        assert gql(UNRELEASE_BURDEN, {"id": burden_id}, token)["unreleasePrayerBurden"]["releasedDate"] is None

    def test_co_shepherd_can_unrelease(self, make_user, status_id):
        owner, _, _ = make_user()
        friend, friend_id, _ = make_user()
        person_id = create_person(owner, status_id)
        burden_id = self.burden(owner, person_id)
        gql(ASSIGN, {"personId": person_id, "userId": friend_id}, owner)
        gql(RELEASE_ID_ONLY, {"id": burden_id}, owner)

        assert gql(UNRELEASE_BURDEN, {"id": burden_id}, friend)["unreleasePrayerBurden"]["releasedDate"] is None
        assert [r["id"] for r in gql(PRAYER_LIST, {}, owner)["activePrayerBurdens"]] == [burden_id]

    def test_stranger_gets_not_found_and_burden_stays_released(self, make_user, status_id):
        owner, _, _ = make_user()
        stranger, _, _ = make_user()
        person_id = create_person(owner, status_id)
        burden_id = self.burden(owner, person_id)
        gql(RELEASE_ID_ONLY, {"id": burden_id}, owner)

        error = gql_error_full(UNRELEASE_BURDEN, {"id": burden_id}, stranger)
        assert error["extensions"]["code"] == "NOT_FOUND"
        assert burden_id not in error["message"]
        assert gql(PRAYER_LIST, {}, owner)["activePrayerBurdens"] == []
        assert [r["id"] for r in gql(RECENTLY_RELEASED, {}, owner)["recentlyReleasedPrayerBurdens"]] == [burden_id]

    def test_unreleasing_active_burden_is_not_found_without_uuid(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        burden_id = self.burden(token, person_id)

        error = gql_error_full(UNRELEASE_BURDEN, {"id": burden_id}, token)
        assert error["extensions"]["code"] == "NOT_FOUND"
        assert burden_id not in error["message"]
        assert [r["id"] for r in gql(PRAYER_LIST, {}, token)["activePrayerBurdens"]] == [burden_id]

    def test_unauthenticated_is_401(self):
        status, _ = post(UNRELEASE_BURDEN, {"id": str(uuid.uuid4())})
        assert status == 401


class TestRecentlyReleasedPrayerBurdens:
    @pytest.fixture()
    def statuses(self, db_connection):
        with db_connection.cursor() as cur:
            cur.execute("SELECT name, id FROM status")
            return {name: str(id_) for name, id_ in cur.fetchall()}

    @pytest.fixture()
    def released_ago(self, db_connection):
        """Backdates a burden's released_date (committed: the API reads it)."""

        def _released_ago(burden_id, days):
            with db_connection.cursor() as cur:
                cur.execute(
                    "UPDATE prayer_burden SET released_date = now() - %s * interval '1 day' WHERE id = %s",
                    (days, burden_id),
                )

        return _released_ago

    def burden(self, token, person_id, content="pray", release=False):
        burden_id = gql(CREATE_BURDEN, {"input": {"personId": person_id, "content": content}}, token)[
            "createPrayerBurden"
        ]["id"]
        if release:
            gql(RELEASE_ID_ONLY, {"id": burden_id}, token)
        return burden_id

    def comment(self, token, person_id, content, burden_id=None):
        fields = {"personId": person_id, "content": content}
        if burden_id:
            fields["prayerBurdenId"] = burden_id
        return gql(CREATE_COMMENT, {"input": fields}, token)["createComment"]["id"]

    def ids(self, token, person_id=None):
        rows = gql(RECENTLY_RELEASED, {"personId": person_id}, token)["recentlyReleasedPrayerBurdens"]
        return [r["id"] for r in rows]

    def test_user_with_no_people_gets_empty_list(self, make_user):
        token, _, _ = make_user()
        assert self.ids(token) == []

    def test_people_with_nothing_released_get_empty_list(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        assert self.ids(token) == []
        assert self.ids(token, person_id) == []
        self.burden(token, person_id, "still active")
        assert self.ids(token) == []

    def test_newest_release_first(self, make_user, status_id, released_ago):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        oldest = self.burden(token, person_id, release=True)
        newest = self.burden(token, person_id, release=True)
        middle = self.burden(token, person_id, release=True)
        released_ago(oldest, 30)
        released_ago(middle, 10)
        released_ago(newest, 1)

        assert self.ids(token) == [newest, middle, oldest]

    def test_excludes_active_burdens(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        self.burden(token, person_id, "active")
        released = self.burden(token, person_id, "gone", release=True)
        assert self.ids(token) == [released]

    def test_includes_burden_released_a_year_ago(self, make_user, status_id, released_ago):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        old = self.burden(token, person_id, release=True)
        released_ago(old, 365)
        assert self.ids(token) == [old]

    def test_only_the_five_newest_are_returned(self, make_user, status_id, released_ago):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        burdens = [self.burden(token, person_id, f"b{i}", release=True) for i in range(7)]
        for days, burden_id in enumerate(burdens, start=1):  # burdens[0] is the newest release
            released_ago(burden_id, days)

        assert self.ids(token) == burdens[:5]

    def test_only_the_callers_people(self, make_user, status_id):
        owner, _, _ = make_user()
        stranger, _, _ = make_user()
        owners_person = create_person(owner, status_id)
        self.burden(owner, owners_person, "private", release=True)
        mine = create_person(stranger, status_id)
        my_burden = self.burden(stranger, mine, "mine", release=True)

        assert self.ids(stranger) == [my_burden]
        assert self.ids(stranger, owners_person) == []

    def test_co_shepherds_both_see_the_burden(self, make_user, status_id):
        owner, _, _ = make_user()
        friend, friend_id, _ = make_user()
        person_id = create_person(owner, status_id)
        burden_id = self.burden(owner, person_id, release=True)
        gql(ASSIGN, {"personId": person_id, "userId": friend_id}, owner)

        assert self.ids(owner) == [burden_id]
        assert self.ids(friend) == [burden_id]

    def test_person_filter(self, make_user, status_id):
        token, _, _ = make_user()
        alice = create_person(token, status_id, name="Alice")
        bob = create_person(token, status_id, name="Bob")
        a_burden = self.burden(token, alice, "for alice", release=True)
        b_burden = self.burden(token, bob, "for bob", release=True)

        assert self.ids(token, alice) == [a_burden]
        assert self.ids(token, bob) == [b_burden]
        assert set(self.ids(token)) == {a_burden, b_burden}

    def test_cap_applies_after_person_filter(self, make_user, status_id, released_ago):
        token, _, _ = make_user()
        alice = create_person(token, status_id, name="Alice")
        bob = create_person(token, status_id, name="Bob")
        bobs = [self.burden(token, bob, f"b{i}", release=True) for i in range(5)]
        for days, burden_id in enumerate(bobs, start=1):
            released_ago(burden_id, days)
        alices = self.burden(token, alice, "old", release=True)
        released_ago(alices, 100)

        assert self.ids(token, alice) == [alices]

    def test_rows_carry_person_status_and_comments_newest_first(self, make_user, statuses):
        token, user_id, _ = make_user(name="Writer")
        person_id = create_person(token, statuses["active"], name="Alice")
        burden_id = self.burden(token, person_id, "prayed")
        bare_id = self.burden(token, person_id, "bare")
        first = self.comment(token, person_id, "first", burden_id)
        self.comment(token, person_id, "standalone")
        second = self.comment(token, person_id, "second", burden_id)
        gql(RELEASE_ID_ONLY, {"id": burden_id}, token)
        gql(RELEASE_ID_ONLY, {"id": bare_id}, token)

        rows = {r["id"]: r for r in gql(RECENTLY_RELEASED, {}, token)["recentlyReleasedPrayerBurdens"]}
        assert set(rows) == {burden_id, bare_id}
        row = rows[burden_id]
        assert row["releasedDate"] is not None
        assert row["person"] == person_dict(person_id, "Alice", statuses["active"], "active")
        assert [c["id"] for c in row["comments"]] == [second, first]
        assert pick(row["comments"][0]["author"], {"id": 0, "name": 0}) == {"id": user_id, "name": "Writer"}
        assert parse_time(row["comments"][0]["createdAt"]) >= parse_time(row["comments"][1]["createdAt"])
        assert rows[bare_id]["comments"] == []

    def test_person_status_follows_updates(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"], name="Alice")
        burden_id = self.burden(token, person_id, release=True)
        gql(UPDATE_STATUS, {"id": person_id, "input": {"statusId": statuses["inactive"]}}, token)

        [row] = gql(RECENTLY_RELEASED, {}, token)["recentlyReleasedPrayerBurdens"]
        assert row["id"] == burden_id
        assert row["person"] == person_dict(person_id, "Alice", statuses["inactive"], "inactive")

    def test_needs_a_token(self):
        status, _ = post(RECENTLY_RELEASED)
        assert status == 401


SEARCH_USERS = """
query SearchUsers($query: String!) {
  searchUsers(query: $query) { id name username }
}"""

ASSIGN_PERSON = """
mutation AssignPerson($personId: UUID!, $userId: UUID!) {
  assignPerson(personId: $personId, userId: $userId) { id shepherds { id name } }
}"""


class TestSearchUsers:
    def search(self, token, query):
        return gql(SEARCH_USERS, {"query": query}, token)["searchUsers"]

    def test_requires_authentication(self):
        status, _ = post(SEARCH_USERS, {"query": "anything"})
        assert status == 401

    def test_finds_by_part_of_name_case_insensitively(self, make_user):
        tag = uuid.uuid4().hex[:10]
        token, _, _ = make_user()
        _, target_id, target_username = make_user(name=f"Mary {tag} Smith")

        for query in (tag, tag.upper(), f"mary {tag}", f"  {tag.upper()}  "):
            rows = self.search(token, query)
            assert [{k: r[k] for k in ("id", "name", "username")} for r in rows] == [
                {"id": target_id, "name": f"Mary {tag} Smith", "username": target_username}
            ]

    def test_finds_by_part_of_username(self, make_user):
        token, _, _ = make_user()
        _, target_id, target_username = make_user()
        part = target_username[-8:]

        rows = self.search(token, part)
        assert [r["id"] for r in rows] == [target_id]
        assert rows[0]["username"] == target_username
        assert [r["id"] for r in self.search(token, part.upper())] == [target_id]

    def test_excludes_the_caller(self, make_user):
        tag = uuid.uuid4().hex[:10]
        token, _, _ = make_user(name=f"Self {tag}")
        _, other_id, _ = make_user(name=f"Other {tag}")

        assert [r["id"] for r in self.search(token, tag)] == [other_id]

    def test_caller_alone_matching_gives_empty_list(self, make_user):
        tag = uuid.uuid4().hex[:10]
        token, _, _ = make_user(name=f"Only {tag}")
        assert self.search(token, tag) == []

    def test_no_match_gives_empty_list(self, make_user):
        token, _, _ = make_user()
        assert self.search(token, f"nomatch{uuid.uuid4().hex}") == []

    def test_fewer_than_two_characters_after_trim_gives_empty_list(self, make_user):
        token, _, _ = make_user()
        make_user(name="Aaa Searchable")
        for query in (" a ", "a", "", "   "):
            assert self.search(token, query) == []

    def test_two_characters_after_trim_searches(self, make_user):
        tag = uuid.uuid4().hex[:10]
        token, _, _ = make_user()
        _, target_id, _ = make_user(name=f"{tag}zq")
        assert [r["id"] for r in self.search(token, f" {tag}zq ")] == [target_id]

    @pytest.mark.parametrize(
        "wild,literal",
        [("%", "%"), ("_", "_"), ("\\", "\\")],
    )
    def test_special_characters_match_literally(self, make_user, wild, literal):
        tag = uuid.uuid4().hex[:10]
        token, _, _ = make_user()
        _, plain_id, _ = make_user(name=f"{tag}ab")
        _, special_id, _ = make_user(name=f"{tag}{literal}ab")

        # As a wildcard, the query would match the plain user too.
        rows = self.search(token, f"{tag}{wild}")
        assert [r["id"] for r in rows] == [special_id]
        assert plain_id not in [r["id"] for r in rows]

    @pytest.mark.parametrize("char", ["%", "_"])
    def test_lone_special_character_does_not_match_everyone(self, make_user, char):
        token, _, _ = make_user()
        _, plain_id, _ = make_user(name="Plain Person")
        rows = self.search(token, char)
        assert plain_id not in [r["id"] for r in rows]
        assert all(char in r["name"] + r["username"] for r in rows)

    def test_query_of_100_characters_is_allowed(self, make_user):
        token, _, _ = make_user()
        assert self.search(token, "q" * 100) == []

    def test_query_over_100_characters_is_bad_user_input(self, make_user):
        token, _, _ = make_user()
        error = gql_error_full(SEARCH_USERS, {"query": "a" * 101}, token)
        assert error["extensions"]["code"] == "BAD_USER_INPUT"
        assert error["message"] == "Search is too long"

    def test_limited_to_ten_ordered_by_name_then_username(self, make_user):
        tag = uuid.uuid4().hex[:10]
        token, _, _ = make_user()
        for i in range(11):
            make_user(name=f"{tag} user {i:02d}")

        rows = self.search(token, tag)
        assert [r["name"] for r in rows] == [f"{tag} user {i:02d}" for i in range(10)]

    def test_same_name_is_ordered_by_username(self, make_user):
        tag = uuid.uuid4().hex[:10]
        token, _, _ = make_user()
        for _ in range(3):
            make_user(name=f"Twin {tag}")

        rows = self.search(token, tag)
        assert len(rows) == 3
        assert [r["username"] for r in rows] == sorted(r["username"] for r in rows)

    def test_search_then_assign_gives_access(self, make_user, status_id):
        tag = uuid.uuid4().hex[:10]
        owner, owner_id, _ = make_user()
        friend, friend_id, _ = make_user(name=f"Friend {tag}")
        person_id = create_person(owner, status_id)

        # Not a shepherd yet, so they cannot read the person.
        assert gql(PERSON, {"id": person_id}, friend)["person"] is None

        found = self.search(owner, tag)
        assert [r["id"] for r in found] == [friend_id]

        assigned = gql(ASSIGN_PERSON, {"personId": person_id, "userId": found[0]["id"]}, owner)["assignPerson"]
        assert assigned["id"] == person_id
        assert {s["id"] for s in assigned["shepherds"]} == {owner_id, friend_id}

        person = gql(PERSON, {"id": person_id}, friend)["person"]
        assert person["id"] == person_id
        assert {s["id"] for s in person["shepherds"]} == {owner_id, friend_id}
        assert person_id in [p["id"] for p in gql(MY_PEOPLE, {}, friend)["myPeople"]]


# ── Rate limits ──────────────────────────────────────────────
#
# The per-address login / register limit is covered by the unit tests
# only: draining it here would block every later make_user from this
# address. The dev .env sets AUTH_RATE_LIMIT_PER_MINUTE high for that.


def assert_rate_limited(status, headers, body, message):
    assert status == 429, body
    assert int(headers["Retry-After"]) >= 1
    [error] = body["errors"]
    assert error["extensions"]["code"] == "RATE_LIMITED"
    assert error["message"] == message


class TestRateLimits:
    TOO_MANY_ATTEMPTS = "Too many attempts. Please wait a moment and try again."
    TOO_MANY_SEARCHES = "Too many searches. Please wait a moment and try again."

    def login(self, username, password):
        return post_with_headers(LOGIN, {"input": {"username": username, "password": password}})

    def fail_five_times(self, username):
        for _ in range(5):
            status, _, body = self.login(username, "wrong-password")
            assert status == 200, body
            assert body["errors"][0]["message"] == "Invalid username or password"

    def test_search_users_is_limited_per_user(self, make_user):
        token, _, _ = make_user()
        other_token, _, _ = make_user()

        # A burst of 20, then one a second: the 21st is refused unless the
        # first 20 took over a second, so allow a few more to reach it.
        for _ in range(20):
            status, _, body = post_with_headers(SEARCH_USERS, {"query": "nobody-here"}, token)
            assert status == 200, body
        for _ in range(10):
            status, headers, body = post_with_headers(SEARCH_USERS, {"query": "nobody-here"}, token)
            if status != 200:
                break
        assert_rate_limited(status, headers, body, self.TOO_MANY_SEARCHES)

        status, _, body = post_with_headers(SEARCH_USERS, {"query": "nobody-here"}, other_token)
        assert status == 200, body

    def test_failed_logins_back_off_even_with_the_right_password(self, make_user):
        _, _, username = make_user(password="right-password")
        self.fail_five_times(username)
        status, headers, body = self.login(username, "right-password")
        assert_rate_limited(status, headers, body, self.TOO_MANY_ATTEMPTS)
        assert headers["Retry-After"] == "1"

    def test_unknown_username_backs_off_the_same(self, make_user):
        _, _, username = make_user(password="right-password")
        unknown = f"no_such_user_{uuid.uuid4().hex[:12]}"
        self.fail_five_times(username)
        self.fail_five_times(unknown)

        known_reply = self.login(username, "right-password")
        unknown_reply = self.login(unknown, "right-password")
        assert_rate_limited(*known_reply, self.TOO_MANY_ATTEMPTS)
        assert (known_reply[0], known_reply[1]["Retry-After"], known_reply[2]) == (
            unknown_reply[0],
            unknown_reply[1]["Retry-After"],
            unknown_reply[2],
        )

    def test_right_password_after_the_wait_signs_in_and_resets(self, make_user):
        _, user_id, username = make_user(password="right-password")
        self.fail_five_times(username)
        status, headers, _ = self.login(username, "right-password")
        assert status == 429
        time.sleep(int(headers["Retry-After"]))

        status, _, body = self.login(username, "right-password")
        assert status == 200, body
        assert body["data"]["login"]["user"]["id"] == user_id
        self.fail_five_times(username)  # counted from zero again


# ── Contact cadence (business rule 6) ────────────────────────

LOG_CONTACT = """
mutation LogContact($input: LogContactInput!) {
  logContact(input: $input) {
    id contactState contactDueAt lastContactedAt status { name }
    contacts { id isFollowUp note contactedBy { id } }
    comments { content contactLogId prayerBurden { id } author { id } }
  }
}"""


def contact_input(person_id, **fields):
    """A LogContactInput as the "Log contact" modal sends it: now, with a note."""
    return {
        "personId": person_id,
        "contactedAt": datetime.now(timezone.utc).isoformat(),
        "note": "Phone call",
        **fields,
    }


DELETE_CONTACT = """
mutation DeleteContact($id: UUID!) {
  deleteContact(id: $id) { id contactState status { name } contacts { id } comments { content } }
}"""

CONTACT_ALERTS = "query { contactAlerts { id name contactState contactDueAt } }"

PERSON_CONTACTS = """
query P($id: UUID!) {
  person(id: $id) {
    contacts { id }
    comments { content prayerBurden { id } }
    prayerBurdens { content }
  }
}"""


class TestContactCadence:
    @pytest.fixture()
    def statuses(self, db_connection):
        with db_connection.cursor() as cur:
            cur.execute("SELECT name, id FROM status")
            return {name: str(id_) for name, id_ in cur.fetchall()}

    @pytest.fixture()
    def backdate(self, db_connection):
        """Makes a person look like they were added `days` ago (committed: the API reads it)."""

        def _backdate(person_id, days):
            with db_connection.cursor() as cur:
                cur.execute(
                    "UPDATE person SET created_at = now() - %s * interval '1 day' WHERE id = %s", (days, person_id)
                )

        return _backdate

    def test_new_person_starts_on_track(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["new contact"])
        person = gql(
            PERSON.replace("isActive", "isActive contactState contactDueAt contacts { id }"), {"id": person_id}, token
        )["person"]
        assert person["contactState"] == "ON_TRACK"
        assert person["contactDueAt"] is not None
        assert person["contacts"] == []  # may be empty

    def test_new_user_has_no_alerts(self, make_user):
        token, _, _ = make_user()
        assert gql(CONTACT_ALERTS, token=token)["contactAlerts"] == []

    def test_log_contact_returns_updated_state(self, make_user, statuses, backdate):
        token, user_id, _ = make_user()
        person_id = create_person(token, statuses["active"])
        backdate(person_id, 10)
        assert [p["id"] for p in gql(CONTACT_ALERTS, token=token)["contactAlerts"]] == [person_id]

        person = gql(LOG_CONTACT, {"input": contact_input(person_id)}, token)["logContact"]
        assert person["contactState"] == "ON_TRACK"
        assert person["lastContactedAt"] is not None
        [contact] = person["contacts"]
        assert (contact["isFollowUp"], contact["note"], contact["contactedBy"]["id"]) == (False, "Phone call", user_id)
        assert gql(CONTACT_ALERTS, token=token)["contactAlerts"] == []

    def test_contact_note_is_a_standalone_comment_removed_on_undo(self, make_user, statuses):
        token, user_id, _ = make_user()
        person_id = create_person(token, statuses["active"])
        person = gql(LOG_CONTACT, {"input": contact_input(person_id, note="Coffee")}, token)["logContact"]
        [note] = person["comments"]
        assert (note["content"], note["prayerBurden"], note["author"]["id"]) == ("Coffee", None, user_id)

        person = gql(DELETE_CONTACT, {"id": person["contacts"][0]["id"]}, token)["deleteContact"]
        assert person["comments"] == []

    def test_contact_note_links_its_contact(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        gql(CREATE_COMMENT, {"input": {"personId": person_id, "content": "Plain note"}}, token)
        person = gql(LOG_CONTACT, {"input": contact_input(person_id, note="Coffee")}, token)["logContact"]
        links = {c["content"]: c["contactLogId"] for c in person["comments"]}
        assert links == {"Coffee": person["contacts"][0]["id"], "Plain note": None}

    def test_undoing_the_follow_up_moves_them_back_to_new_contact(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["new contact"])
        logged = gql(LOG_CONTACT, {"input": contact_input(person_id)}, token)["logContact"]
        assert logged["status"]["name"] == "active"

        person = gql(DELETE_CONTACT, {"id": logged["contacts"][0]["id"]}, token)["deleteContact"]
        assert person["status"]["name"] == "new contact"
        assert person["contacts"] == []

    @pytest.mark.parametrize("missing", ["contactedAt", "note"])
    def test_date_and_note_required(self, make_user, statuses, missing):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        input_ = contact_input(person_id)
        del input_[missing]
        error = gql_error_full(LOG_CONTACT, {"input": input_}, token)
        assert error["extensions"]["code"] == "BAD_USER_INPUT"

    @pytest.mark.parametrize("note", ["", "   "])
    def test_blank_note_rejected_and_nothing_logged(self, make_user, statuses, note):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        error = gql_error_full(LOG_CONTACT, {"input": contact_input(person_id, note=note)}, token)
        assert error["extensions"]["code"] == "BAD_USER_INPUT"
        person = gql(PERSON_CONTACTS, {"id": person_id}, token)["person"]
        assert (person["contacts"], person["comments"]) == ([], [])

    def test_prayer_burden_added_with_contact_and_removed_on_undo(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        logged = gql(LOG_CONTACT, {"input": contact_input(person_id, prayerBurden=" Her new job ")}, token)[
            "logContact"
        ]
        person = gql(PERSON_CONTACTS, {"id": person_id}, token)["person"]
        [burden] = person["prayerBurdens"]
        # The note stays a standalone comment (rule 5), not one on the burden.
        assert burden["content"] == "Her new job"
        assert [c["prayerBurden"] for c in person["comments"]] == [None]

        gql(DELETE_CONTACT, {"id": logged["contacts"][0]["id"]}, token)
        person = gql(PERSON_CONTACTS, {"id": person_id}, token)["person"]
        assert (person["prayerBurdens"], person["comments"]) == ([], [])

    @pytest.mark.parametrize("prayer_burden", [None, "", "   "])
    def test_no_prayer_burden_adds_none(self, make_user, statuses, prayer_burden):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        gql(LOG_CONTACT, {"input": contact_input(person_id, prayerBurden=prayer_burden)}, token)
        assert gql(PERSON_CONTACTS, {"id": person_id}, token)["person"]["prayerBurdens"] == []

    @pytest.mark.parametrize("is_follow_up", [None, False, True])
    def test_any_contact_follows_up_a_new_contact(self, make_user, statuses, is_follow_up):
        """Adding someone is the first contact, so the next one logged is the follow-up; isFollowUp is ignored."""
        token, _, _ = make_user()
        person_id = create_person(token, statuses["new contact"])
        input_ = contact_input(person_id) if is_follow_up is None else contact_input(person_id, isFollowUp=is_follow_up)
        person = gql(LOG_CONTACT, {"input": input_}, token)["logContact"]
        assert person["status"]["name"] == "active"
        assert person["contacts"][0]["isFollowUp"] is True

        # From now on they are a regular contact: the 7-day rule, and no more follow-ups.
        person = gql(LOG_CONTACT, {"input": contact_input(person_id)}, token)["logContact"]
        assert person["contacts"][0]["isFollowUp"] is False
        assert person["contactState"] == "ON_TRACK"

    def test_contact_for_active_person_is_not_a_follow_up(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        person = gql(LOG_CONTACT, {"input": contact_input(person_id, isFollowUp=True)}, token)["logContact"]
        assert person["contacts"][0]["isFollowUp"] is False

    def test_alerts_most_urgent_first(self, make_user, statuses, backdate):
        token, _, _ = make_user()
        week_late = create_person(token, statuses["active"], name="Week late")
        month_late = create_person(token, statuses["active"], name="Month late")
        due_soon = create_person(token, statuses["new contact"], name="Due soon")
        create_person(token, statuses["inactive"], name="Not tracked")
        backdate(week_late, 8)
        backdate(month_late, 30)
        backdate(due_soon, 2.5)

        alerts = gql(CONTACT_ALERTS, token=token)["contactAlerts"]
        assert [(p["id"], p["contactState"]) for p in alerts] == [
            (month_late, "OVERDUE"),
            (week_late, "OVERDUE"),
            (due_soon, "DUE_SOON"),
        ]

    def test_shared_person_alerts_every_shepherd_and_clears_for_all(self, make_user, statuses, backdate):
        owner, _, _ = make_user()
        coleader, coleader_id, _ = make_user()
        person_id = create_person(owner, statuses["active"])
        gql(
            "mutation A($personId: UUID!, $userId: UUID!) { assignPerson(personId: $personId, userId: $userId) { id } }",
            {"personId": person_id, "userId": coleader_id},
            owner,
        )
        backdate(person_id, 10)
        for token in (owner, coleader):
            assert [p["id"] for p in gql(CONTACT_ALERTS, token=token)["contactAlerts"]] == [person_id]

        gql(LOG_CONTACT, {"input": contact_input(person_id)}, coleader)
        for token in (owner, coleader):
            assert gql(CONTACT_ALERTS, token=token)["contactAlerts"] == []

    def test_delete_contact_restores_previous_state(self, make_user, statuses, backdate):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        backdate(person_id, 10)
        logged = gql(LOG_CONTACT, {"input": contact_input(person_id)}, token)["logContact"]
        person = gql(DELETE_CONTACT, {"id": logged["contacts"][0]["id"]}, token)["deleteContact"]
        assert person["contactState"] == "OVERDUE"
        assert person["contacts"] == []

    def test_stranger_cannot_log_or_delete_contacts(self, make_user, statuses):
        owner, _, _ = make_user()
        stranger, _, _ = make_user()
        person_id = create_person(owner, statuses["active"])
        error = gql_error_full(LOG_CONTACT, {"input": contact_input(person_id)}, stranger)
        assert error["extensions"]["code"] == "NOT_FOUND"

        logged = gql(LOG_CONTACT, {"input": contact_input(person_id)}, owner)["logContact"]
        error = gql_error_full(DELETE_CONTACT, {"id": logged["contacts"][0]["id"]}, stranger)
        assert error["extensions"]["code"] == "NOT_FOUND"
        assert (
            error["message"]
            == gql_error_full(DELETE_CONTACT, {"id": "00000000-0000-0000-0000-000000000000"}, stranger)["message"]
        )

    @pytest.mark.parametrize("contacted_at", ["2999-01-01T00:00:00Z", "not a time"])
    def test_bad_contact_time_rejected(self, make_user, statuses, contacted_at):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        error = gql_error_full(LOG_CONTACT, {"input": contact_input(person_id, contactedAt=contacted_at)}, token)
        assert error["extensions"]["code"] == "BAD_USER_INPUT"

    def test_backdated_contact(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        person = gql(LOG_CONTACT, {"input": contact_input(person_id, contactedAt="2026-01-05T10:00:00Z")}, token)[
            "logContact"
        ]
        assert parse_time(person["lastContactedAt"]) == datetime(2026, 1, 5, 10, tzinfo=timezone.utc)
        assert person["contactState"] == "OVERDUE"

    def test_update_person_ignores_last_contact_date(self, make_user, statuses):
        """The removed lastContactDate input no longer logs a contact."""
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        updated = gql(
            "mutation U($id: UUID!, $input: UpdatePersonInput!) {"
            " updatePerson(id: $id, input: $input) { id lastContactedAt lastContactDate contacts { id } } }",
            {"id": person_id, "input": {"lastContactDate": "2026-01-05"}},
            token,
        )["updatePerson"]
        assert updated["contacts"] == []
        assert updated["lastContactedAt"] is None
        assert "lastContactDate" not in updated

    def test_person_has_no_last_contact_date(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        gql(LOG_CONTACT, {"input": contact_input(person_id)}, token)
        person = gql(
            "query P($id: UUID!) { person(id: $id) { id lastContactedAt lastContactDate } }", {"id": person_id}, token
        )["person"]
        [mine] = gql("query { myPeople { id lastContactedAt lastContactDate } }", token=token)["myPeople"]
        assert person["lastContactedAt"] is not None
        assert "lastContactDate" not in person
        assert "lastContactDate" not in mine


# ── Per-person summaries on list queries ─────────────────────

SUMMARY_FIELDS = """
    id recordedMilestoneIds activeBurdenCount
    latestComment { content createdAt author { id name } prayerBurden { id } }
    shepherds { id name }
"""

MY_PEOPLE_SUMMARY = "query { myPeople { " + SUMMARY_FIELDS + " } }"
ALERTS_SUMMARY = "query { contactAlerts { " + SUMMARY_FIELDS + " } }"

RECORD_MILESTONE = """
mutation RecordMilestone($input: RecordMilestoneInput!) { recordMilestone(input: $input) { id } }"""


class TestPersonSummaries:
    @pytest.fixture()
    def milestone_ids(self, db_connection):
        with db_connection.cursor() as cur:
            cur.execute("SELECT name, id FROM milestone")
            return {name: str(id_) for name, id_ in cur.fetchall()}

    def test_new_person_has_empty_summaries(self, make_user, status_id):
        token, user_id, _ = make_user(name="Solo Shepherd")
        person_id = create_person(token, status_id)
        [person] = gql(MY_PEOPLE_SUMMARY, token=token)["myPeople"]
        assert person["id"] == person_id
        assert person["recordedMilestoneIds"] == []  # rule 2
        assert person["activeBurdenCount"] == 0  # rule 3
        assert person["latestComment"] is None
        assert [(s["id"], s["name"]) for s in person["shepherds"]] == [(user_id, "Solo Shepherd")]

    def test_milestones_and_burden_count(self, make_user, status_id, milestone_ids):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        for name in ("baptised", "serving"):
            gql(RECORD_MILESTONE, {"input": {"personId": person_id, "milestoneId": milestone_ids[name]}}, token)
        burden_ids = [
            gql(CREATE_BURDEN, {"input": {"personId": person_id, "content": text}}, token)["createPrayerBurden"]["id"]
            for text in ("Health", "Work", "Family")
        ]
        gql("mutation R($id: UUID!) { releasePrayerBurden(id: $id) { id } }", {"id": burden_ids[0]}, token)

        [person] = gql(MY_PEOPLE_SUMMARY, token=token)["myPeople"]
        # Out of order: serving without joining a small group.
        assert sorted(person["recordedMilestoneIds"]) == sorted([milestone_ids["baptised"], milestone_ids["serving"]])
        assert person["activeBurdenCount"] == 2  # released burdens don't count

    def test_latest_comment_is_newest_of_any_kind(self, make_user, status_id):
        token, user_id, _ = make_user(name="Writer")
        person_id = create_person(token, status_id)
        burden_id = gql(CREATE_BURDEN, {"input": {"personId": person_id, "content": "Exams"}}, token)[
            "createPrayerBurden"
        ]["id"]

        gql(CREATE_COMMENT, {"input": {"personId": person_id, "content": "Standalone"}}, token)
        gql(CREATE_COMMENT, {"input": {"personId": person_id, "prayerBurdenId": burden_id, "content": "On it"}}, token)
        [person] = gql(MY_PEOPLE_SUMMARY, token=token)["myPeople"]
        shape = {"content": 0, "author": {"id": 0, "name": 0}, "prayerBurden": {"id": 0}}
        assert pick(person["latestComment"], shape) == {
            "content": "On it",
            "author": {"id": user_id, "name": "Writer"},
            "prayerBurden": {"id": burden_id},
        }
        assert person["latestComment"]["createdAt"] is not None

        # A contact note is a standalone comment (rule 5), so it becomes the latest; undo brings back the one before.
        logged = gql(LOG_CONTACT, {"input": contact_input(person_id, note="Called her")}, token)["logContact"]
        [person] = gql(MY_PEOPLE_SUMMARY, token=token)["myPeople"]
        assert (person["latestComment"]["content"], person["latestComment"]["prayerBurden"]) == ("Called her", None)

        gql(DELETE_CONTACT, {"id": logged["contacts"][0]["id"]}, token)
        [person] = gql(MY_PEOPLE_SUMMARY, token=token)["myPeople"]
        assert person["latestComment"]["content"] == "On it"

    def test_shepherds_on_list_queries(self, make_user, status_id, db_connection):
        owner, owner_id, _ = make_user(name="Owner")
        friend, friend_id, _ = make_user(name="Grace")
        shared = create_person(owner, status_id, name="Shared")
        mine = create_person(owner, status_id, name="Mine")
        gql(ASSIGN_PERSON, {"personId": shared, "userId": friend_id}, owner)
        with db_connection.cursor() as cur:
            cur.execute("UPDATE person SET created_at = now() - interval '10 days' WHERE id = %s", (shared,))

        people = {p["id"]: p for p in gql(MY_PEOPLE_SUMMARY, token=owner)["myPeople"]}
        assert [s["id"] for s in people[shared]["shepherds"]] == [friend_id, owner_id]  # by name
        assert [s["id"] for s in people[mine]["shepherds"]] == [owner_id]

        # Every shepherd sees the alert (rule 6) with the same summary.
        for token in (owner, friend):
            [alert] = gql(ALERTS_SUMMARY, token=token)["contactAlerts"]
            assert alert["id"] == shared
            assert {s["name"] for s in alert["shepherds"]} == {"Owner", "Grace"}

    def test_mutations_return_summaries(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        person = gql(
            "mutation L($input: LogContactInput!) { logContact(input: $input) { " + SUMMARY_FIELDS + " } }",
            {"input": contact_input(person_id, note="Lunch")},
            token,
        )["logContact"]
        assert person["latestComment"]["content"] == "Lunch"
        assert person["recordedMilestoneIds"] == []


# ── Contact clock restarts on a manual status move (business rule 6) ──

UPDATE_STATUS = """
mutation U($id: UUID!, $input: UpdatePersonInput!) {
  updatePerson(id: $id, input: $input) { id contactState contactDueAt contactClockStart }
}"""


def parse_time(value):
    # Postgres text, e.g. "2026-10-20 17:14:56.3+00"; Python 3.10 needs "+00:00"
    # and 3 or 6 fraction digits, but Postgres drops trailing zeros.
    value = re.sub(r"\.(\d{1,6})", lambda m: "." + m.group(1).ljust(6, "0"), value)
    return datetime.fromisoformat(re.sub(r"([+-]\d\d)$", r"\1:00", value))


class TestContactClockStart:
    @pytest.fixture()
    def statuses(self, db_connection):
        with db_connection.cursor() as cur:
            cur.execute("SELECT name, id FROM status")
            return {name: str(id_) for name, id_ in cur.fetchall()}

    @pytest.fixture()
    def backdate(self, db_connection):
        def _backdate(person_id, days):
            with db_connection.cursor() as cur:
                cur.execute(
                    "UPDATE person SET created_at = now() - %s * interval '1 day' WHERE id = %s", (days, person_id)
                )

        return _backdate

    def test_clock_start_on_person_my_people_and_alerts(self, make_user, statuses, backdate):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        backdate(person_id, 10)

        person = gql(PERSON.replace("isActive", "isActive contactClockStart"), {"id": person_id}, token)["person"]
        [mine] = gql("query { myPeople { id contactClockStart } }", token=token)["myPeople"]
        [alert] = gql("query { contactAlerts { id contactClockStart } }", token=token)["contactAlerts"]

        assert person["contactClockStart"] == mine["contactClockStart"] == alert["contactClockStart"]
        age = datetime.now(timezone.utc) - parse_time(person["contactClockStart"])
        assert timedelta(days=9) < age < timedelta(days=11)  # no contacts: runs from created_at

    def test_user_with_no_people_has_no_clock_starts(self, make_user):
        token, _, _ = make_user()
        assert gql("query { myPeople { id contactClockStart } }", token=token)["myPeople"] == []

    def test_manual_move_back_to_active_restarts_the_clock(self, make_user, statuses, backdate):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        backdate(person_id, 10)
        assert [p["id"] for p in gql(CONTACT_ALERTS, token=token)["contactAlerts"]] == [person_id]

        inactive = gql(UPDATE_STATUS, {"id": person_id, "input": {"statusId": statuses["inactive"]}}, token)
        assert inactive["updatePerson"]["contactClockStart"] is None
        active = gql(UPDATE_STATUS, {"id": person_id, "input": {"statusId": statuses["active"]}}, token)
        person = active["updatePerson"]

        start, due = parse_time(person["contactClockStart"]), parse_time(person["contactDueAt"])
        assert abs(datetime.now(timezone.utc) - start) < timedelta(minutes=5)
        assert due - start == timedelta(days=7)
        assert person["contactState"] == "ON_TRACK"
        assert gql(CONTACT_ALERTS, token=token)["contactAlerts"] == []

    @pytest.mark.parametrize("status_name", ["inactive", "lost contact"])
    def test_clock_start_null_when_not_tracked(self, make_user, statuses, status_name):
        token, _, _ = make_user()
        person_id = create_person(token, statuses[status_name])
        query = PERSON.replace("isActive", "isActive contactState contactClockStart")
        person = gql(query, {"id": person_id}, token)["person"]
        assert (person["contactState"], person["contactClockStart"]) == ("NOT_TRACKED", None)


# ── Undoing a status move ────────────────────────────────────

UPDATE_STATUS_STAMP = """
mutation U($id: UUID!, $input: UpdatePersonInput!) {
  updatePerson(id: $id, input: $input) { id status { name } statusChangedAt }
}"""

UNDO_STATUS = """
mutation Undo($personId: UUID!, $statusId: UUID!, $statusChangedAt: DateTime!) {
  undoStatusChange(personId: $personId, statusId: $statusId, statusChangedAt: $statusChangedAt) {
    id status { name } statusChangedAt contactState contactClockStart
  }
}"""

SOME_STAMP = "2026-10-20T12:00:00Z"


class TestUndoStatusChange:
    @pytest.fixture()
    def statuses(self, db_connection):
        with db_connection.cursor() as cur:
            cur.execute("SELECT name, id FROM status")
            return {name: str(id_) for name, id_ in cur.fetchall()}

    def move(self, token, person_id, statuses, name):
        data = gql(UPDATE_STATUS_STAMP, {"id": person_id, "input": {"statusId": statuses[name]}}, token)
        return data["updatePerson"]

    def undo_vars(self, person_id, statuses, name, stamp):
        return {"personId": person_id, "statusId": statuses[name], "statusChangedAt": stamp}

    def test_status_changed_at_null_until_the_first_move(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        query = PERSON.replace("isActive", "isActive statusChangedAt")
        assert gql(query, {"id": person_id}, token)["person"]["statusChangedAt"] is None
        [mine] = gql("query { myPeople { id statusChangedAt } }", token=token)["myPeople"]
        assert mine["statusChangedAt"] is None

        moved = self.move(token, person_id, statuses, "inactive")
        assert moved["statusChangedAt"] is not None
        [mine] = gql("query { myPeople { id statusChangedAt } }", token=token)["myPeople"]
        assert mine["statusChangedAt"] == moved["statusChangedAt"]
        assert gql(query, {"id": person_id}, token)["person"]["statusChangedAt"] == moved["statusChangedAt"]

    def test_user_with_no_people_has_no_status_stamps(self, make_user):
        token, _, _ = make_user()
        assert gql("query { myPeople { id statusChangedAt } }", token=token)["myPeople"] == []

    def test_resaving_the_same_status_leaves_the_stamp_null(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        assert self.move(token, person_id, statuses, "active")["statusChangedAt"] is None

    def test_undo_round_trips_the_returned_stamp_and_keeps_the_alert(self, make_user, statuses, db_connection):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        with db_connection.cursor() as cur:
            cur.execute("UPDATE person SET created_at = now() - interval '10 days' WHERE id = %s", (person_id,))
        before = gql("query { myPeople { id contactClockStart } }", token=token)["myPeople"][0]

        moved = self.move(token, person_id, statuses, "inactive")
        assert moved["status"]["name"] == "inactive"
        variables = self.undo_vars(person_id, statuses, "inactive", moved["statusChangedAt"])
        person = gql(UNDO_STATUS, variables, token)["undoStatusChange"]

        assert person["id"] == person_id
        assert person["status"]["name"] == "active"
        assert person["statusChangedAt"] is None
        assert person["contactState"] == "OVERDUE"
        assert person["contactClockStart"] == before["contactClockStart"]
        assert [p["id"] for p in gql(CONTACT_ALERTS, token=token)["contactAlerts"]] == [person_id]

    def test_second_undo_is_a_conflict_naming_the_person(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"], name="Bartholomew")
        moved = self.move(token, person_id, statuses, "inactive")
        variables = self.undo_vars(person_id, statuses, "inactive", moved["statusChangedAt"])
        gql(UNDO_STATUS, variables, token)

        error = gql_error_full(UNDO_STATUS, variables, token)
        assert error["extensions"]["code"] == "CONFLICT"
        assert error["message"] == "Bartholomew's status has changed since"

    def test_undo_of_a_person_never_moved_is_a_conflict(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        variables = self.undo_vars(person_id, statuses, "active", SOME_STAMP)
        error = gql_error_full(UNDO_STATUS, variables, token)
        assert error["extensions"]["code"] == "CONFLICT"

    def test_stale_move_is_a_conflict(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        first = self.move(token, person_id, statuses, "inactive")
        second = self.move(token, person_id, statuses, "lost contact")
        stale = self.undo_vars(person_id, statuses, "inactive", first["statusChangedAt"])
        assert gql_error_full(UNDO_STATUS, stale, token)["extensions"]["code"] == "CONFLICT"

        latest = self.undo_vars(person_id, statuses, "lost contact", second["statusChangedAt"])
        assert gql(UNDO_STATUS, latest, token)["undoStatusChange"]["status"]["name"] == "inactive"

    def test_stranger_gets_not_found_and_nothing_changes(self, make_user, statuses):
        owner, _, _ = make_user()
        stranger, _, _ = make_user()
        person_id = create_person(owner, statuses["active"])
        moved = self.move(owner, person_id, statuses, "inactive")
        variables = self.undo_vars(person_id, statuses, "inactive", moved["statusChangedAt"])

        error = gql_error_full(UNDO_STATUS, variables, stranger)
        assert error["extensions"]["code"] == "NOT_FOUND"
        assert error["message"] == "Person not found"
        # Still undoable by the owner.
        assert gql(UNDO_STATUS, variables, owner)["undoStatusChange"]["status"]["name"] == "active"

    def test_unknown_person_is_not_found(self, make_user, statuses):
        token, _, _ = make_user()
        variables = self.undo_vars(str(uuid.uuid4()), statuses, "active", SOME_STAMP)
        error = gql_error_full(UNDO_STATUS, variables, token)
        assert error["extensions"]["code"] == "NOT_FOUND"
        assert error["message"] == "Person not found"

    def test_requires_a_token(self, statuses):
        status, _ = post(UNDO_STATUS, self.undo_vars(str(uuid.uuid4()), statuses, "active", SOME_STAMP))
        assert status == 401


# ── Prayer log ───────────────────────────────────────────────

PRAYER_FIELDS = """
  id contactState contactDueAt lastContactedAt status { name }
  lastPrayer { id prayedAt createdAt prayedBy { id } }
  prayers { id prayedAt createdAt prayedBy { id } }
"""

RECORD_PRAYER = (
    """
mutation RecordPrayer($personId: UUID!, $prayedAt: DateTime) {
  recordPrayer(personId: $personId, prayedAt: $prayedAt) {"""
    + PRAYER_FIELDS
    + "} }"
)

DELETE_PRAYER = (
    """
mutation DeletePrayer($id: UUID!) {
  deletePrayer(id: $id) {"""
    + PRAYER_FIELDS
    + "} }"
)

PERSON_PRAYERS = "query P($id: UUID!) { person(id: $id) { prayers { id prayedBy { id } } lastPrayer { id } } }"
MY_PEOPLE_PRAYERS = "query { myPeople { id lastPrayer { id prayedBy { id } } } }"


class TestPrayerLog:
    @pytest.fixture()
    def pair(self, make_user, status_id):
        """Two shepherds (a, b) of one person."""
        a_token, a_id, _ = make_user()
        b_token, b_id, _ = make_user()
        person_id = create_person(a_token, status_id)
        gql(ASSIGN, {"personId": person_id, "userId": b_id}, a_token)
        return a_token, a_id, b_token, b_id, person_id

    def test_person_never_prayed_for(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        person = gql(PERSON_PRAYERS, {"id": person_id}, token)["person"]
        assert (person["lastPrayer"], person["prayers"]) == (None, [])
        [mine] = gql(MY_PEOPLE_PRAYERS, token=token)["myPeople"]
        assert mine["lastPrayer"] is None

    def test_user_with_no_people(self, make_user):
        token, _, _ = make_user()
        assert gql(MY_PEOPLE_PRAYERS, token=token)["myPeople"] == []

    def test_record_prayer_returns_person_with_the_record(self, make_user, status_id):
        token, user_id, _ = make_user()
        person_id = create_person(token, status_id)  # no burdens: can still be prayed for
        person = gql(RECORD_PRAYER, {"personId": person_id}, token)["recordPrayer"]
        assert person["id"] == person_id
        assert person["lastPrayer"]["prayedBy"]["id"] == user_id
        assert person["prayers"] == [person["lastPrayer"]]
        assert abs((datetime.now(timezone.utc) - parse_time(person["lastPrayer"]["prayedAt"])).total_seconds()) < 60

    def test_my_people_carries_last_prayer(self, make_user, status_id):
        token, user_id, _ = make_user()
        person_id = create_person(token, status_id)
        prayer = gql(RECORD_PRAYER, {"personId": person_id}, token)["recordPrayer"]["lastPrayer"]
        [mine] = gql(MY_PEOPLE_PRAYERS, token=token)["myPeople"]
        assert mine["lastPrayer"]["id"] == prayer["id"]
        assert mine["lastPrayer"]["prayedBy"]["id"] == user_id

    def test_each_call_is_its_own_record(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        gql(RECORD_PRAYER, {"personId": person_id}, token)
        person = gql(RECORD_PRAYER, {"personId": person_id}, token)["recordPrayer"]
        assert len(person["prayers"]) == 2
        assert person["prayers"][0]["id"] != person["prayers"][1]["id"]

    def test_co_shepherds_see_each_others_prayers(self, pair):
        a_token, a_id, b_token, b_id, person_id = pair
        gql(RECORD_PRAYER, {"personId": person_id}, a_token)
        gql(RECORD_PRAYER, {"personId": person_id}, b_token)
        for token in (a_token, b_token):
            person = gql(PERSON_PRAYERS, {"id": person_id}, token)["person"]
            assert {p["prayedBy"]["id"] for p in person["prayers"]} == {a_id, b_id}
            assert person["lastPrayer"]["id"] == person["prayers"][0]["id"]
            assert person["lastPrayer"]["id"] == gql(MY_PEOPLE_PRAYERS, token=token)["myPeople"][0]["lastPrayer"]["id"]
        # b prayed last, and a sees that
        assert gql(PERSON_PRAYERS, {"id": person_id}, a_token)["person"]["prayers"][0]["prayedBy"]["id"] == b_id

    def test_back_dated_prayer_saved_as_given(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        when = datetime.now(timezone.utc) - timedelta(days=3)
        person = gql(RECORD_PRAYER, {"personId": person_id, "prayedAt": when.isoformat()}, token)["recordPrayer"]
        saved = person["lastPrayer"]
        assert abs((parse_time(saved["prayedAt"]) - when).total_seconds()) < 1
        assert parse_time(saved["createdAt"]) - parse_time(saved["prayedAt"]) > timedelta(days=2)

    def test_last_prayer_is_latest_by_prayed_at_and_list_newest_first(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        now = datetime.now(timezone.utc)
        recent = gql(RECORD_PRAYER, {"personId": person_id, "prayedAt": (now - timedelta(hours=1)).isoformat()}, token)
        recent_id = recent["recordPrayer"]["lastPrayer"]["id"]
        gql(RECORD_PRAYER, {"personId": person_id, "prayedAt": (now - timedelta(days=5)).isoformat()}, token)
        person = gql(RECORD_PRAYER, {"personId": person_id, "prayedAt": (now - timedelta(days=2)).isoformat()}, token)[
            "recordPrayer"
        ]
        # The newest record made is not the latest prayer.
        assert person["lastPrayer"]["id"] == recent_id
        times = [parse_time(p["prayedAt"]) for p in person["prayers"]]
        assert times == sorted(times, reverse=True) and len(times) == 3

    def test_future_prayer_rejected(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        when = datetime.now(timezone.utc) + timedelta(minutes=30)
        error = gql_error_full(RECORD_PRAYER, {"personId": person_id, "prayedAt": when.isoformat()}, token)
        assert error["extensions"]["code"] == "BAD_USER_INPUT"
        assert gql(PERSON_PRAYERS, {"id": person_id}, token)["person"]["prayers"] == []

    @pytest.mark.parametrize("value", ["-infinity", "infinity"])
    def test_infinite_prayer_time_rejected(self, make_user, status_id, value):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        error = gql_error_full(RECORD_PRAYER, {"personId": person_id, "prayedAt": value}, token)
        assert error["extensions"]["code"] == "BAD_USER_INPUT"
        assert gql(PERSON_PRAYERS, {"id": person_id}, token)["person"]["prayers"] == []

    def test_praying_is_not_a_contact(self, make_user, status_id, db_connection):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        with db_connection.cursor() as cur:  # overdue: no contact in 10 days
            cur.execute("UPDATE person SET created_at = now() - interval '10 days' WHERE id = %s", (person_id,))
        before = gql("query P($id: UUID!) { person(id: $id) { " + PRAYER_FIELDS + " } }", {"id": person_id}, token)[
            "person"
        ]
        assert before["contactState"] == "OVERDUE"
        after = gql(RECORD_PRAYER, {"personId": person_id}, token)["recordPrayer"]
        for field in ("contactState", "lastContactedAt", "contactDueAt", "status"):
            assert after[field] == before[field]

    def test_praying_does_not_follow_up_a_new_contact(self, make_user, db_connection):
        token, _, _ = make_user()
        with db_connection.cursor() as cur:
            cur.execute("SELECT id FROM status WHERE name = 'new contact'")
            new_id = str(cur.fetchone()[0])
        person_id = create_person(token, new_id)
        person = gql(RECORD_PRAYER, {"personId": person_id}, token)["recordPrayer"]
        assert person["status"]["name"] == "new contact"
        assert person["lastContactedAt"] is None

    def test_non_shepherd_cannot_record(self, make_user, status_id):
        token, _, _ = make_user()
        outsider, _, _ = make_user()
        person_id = create_person(token, status_id)
        error = gql_error_full(RECORD_PRAYER, {"personId": person_id}, outsider)
        assert error["extensions"]["code"] == "NOT_FOUND"
        assert gql(PERSON_PRAYERS, {"id": person_id}, token)["person"]["prayers"] == []

    def test_unknown_person_is_not_found(self, make_user):
        token, _, _ = make_user()
        error = gql_error_full(RECORD_PRAYER, {"personId": str(uuid.uuid4())}, token)
        assert error["extensions"]["code"] == "NOT_FOUND"

    def test_recorder_can_delete_their_own(self, make_user, status_id):
        token, _, _ = make_user()
        person_id = create_person(token, status_id)
        now = datetime.now(timezone.utc)
        earlier = gql(RECORD_PRAYER, {"personId": person_id, "prayedAt": (now - timedelta(days=1)).isoformat()}, token)
        earlier_id = earlier["recordPrayer"]["lastPrayer"]["id"]
        latest = gql(RECORD_PRAYER, {"personId": person_id}, token)["recordPrayer"]["lastPrayer"]

        person = gql(DELETE_PRAYER, {"id": latest["id"]}, token)["deletePrayer"]
        assert [p["id"] for p in person["prayers"]] == [earlier_id]
        assert person["lastPrayer"]["id"] == earlier_id  # falls back to the previous one

        person = gql(DELETE_PRAYER, {"id": earlier_id}, token)["deletePrayer"]
        assert (person["lastPrayer"], person["prayers"]) == (None, [])

    def test_co_shepherd_cannot_delete_anothers_prayer(self, pair):
        a_token, _, b_token, _, person_id = pair
        prayer_id = gql(RECORD_PRAYER, {"personId": person_id}, a_token)["recordPrayer"]["lastPrayer"]["id"]
        error = gql_error_full(DELETE_PRAYER, {"id": prayer_id}, b_token)
        assert error["extensions"]["code"] == "NOT_FOUND"
        assert [p["id"] for p in gql(PERSON_PRAYERS, {"id": person_id}, a_token)["person"]["prayers"]] == [prayer_id]

    def test_non_shepherd_cannot_delete(self, make_user, status_id):
        token, _, _ = make_user()
        outsider, _, _ = make_user()
        person_id = create_person(token, status_id)
        prayer_id = gql(RECORD_PRAYER, {"personId": person_id}, token)["recordPrayer"]["lastPrayer"]["id"]
        error = gql_error_full(DELETE_PRAYER, {"id": prayer_id}, outsider)
        assert error["extensions"]["code"] == "NOT_FOUND"
        assert len(gql(PERSON_PRAYERS, {"id": person_id}, token)["person"]["prayers"]) == 1

    def test_recorder_cannot_delete_after_being_unassigned(self, pair):
        a_token, _, b_token, b_id, person_id = pair
        prayer_id = gql(RECORD_PRAYER, {"personId": person_id}, b_token)["recordPrayer"]["lastPrayer"]["id"]
        gql(UNASSIGN, {"personId": person_id, "userId": b_id}, a_token)
        error = gql_error_full(DELETE_PRAYER, {"id": prayer_id}, b_token)
        assert error["extensions"]["code"] == "NOT_FOUND"
        assert [p["id"] for p in gql(PERSON_PRAYERS, {"id": person_id}, a_token)["person"]["prayers"]] == [prayer_id]

    def test_delete_unknown_prayer_is_not_found(self, make_user):
        token, _, _ = make_user()
        error = gql_error_full(DELETE_PRAYER, {"id": str(uuid.uuid4())}, token)
        assert error["extensions"]["code"] == "NOT_FOUND"

    def test_deleted_users_prayers_stay_with_no_one_credited(self, pair, db_connection):
        a_token, _, b_token, b_id, person_id = pair
        gql(RECORD_PRAYER, {"personId": person_id}, b_token)
        with db_connection.cursor() as cur:
            cur.execute('DELETE FROM "user" WHERE id = %s', (b_id,))
        person = gql(PERSON_PRAYERS, {"id": person_id}, a_token)["person"]
        assert len(person["prayers"]) == 1
        assert person["prayers"][0]["prayedBy"] is None
        assert person["lastPrayer"]["id"] == person["prayers"][0]["id"]
        [mine] = gql(MY_PEOPLE_PRAYERS, token=a_token)["myPeople"]
        assert mine["lastPrayer"]["prayedBy"] is None
