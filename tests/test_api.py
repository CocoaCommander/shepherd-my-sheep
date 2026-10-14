"""
End-to-end tests for the GraphQL API: authentication, per-user
authorization, and the response shape GraphQL clients depend on.

These need the API running (docker compose up) and are skipped when it
is not reachable. Every user they create is deleted afterwards, along
with the people assigned to those users.
"""

import json
import os
import urllib.error
import urllib.request
import uuid

import pytest

API_HOST = os.getenv("API_HOST")
API_PORT = os.getenv("API_PORT")
if not API_HOST or not API_PORT:
    pytest.skip("API_HOST / API_PORT not set", allow_module_level=True)

# 0.0.0.0 is a bind address, not somewhere to connect to.
_connect_host = "localhost" if API_HOST == "0.0.0.0" else API_HOST
GRAPHQL_URL = f"http://{_connect_host}:{API_PORT}/graphql"

try:
    urllib.request.urlopen(f"http://{_connect_host}:{API_PORT}/health", timeout=2)
except OSError:
    pytest.skip(f"API not reachable at {GRAPHQL_URL}", allow_module_level=True)


# ── Helpers ──────────────────────────────────────────────────


def post(query, variables=None, token=None):
    """Returns (http_status, body)."""
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    request = urllib.request.Request(GRAPHQL_URL, data=body, method="POST")
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


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

    def _make(password="correct-horse"):
        username = f"apitest_{uuid.uuid4().hex[:12]}"
        data = gql(REGISTER, {"input": {"name": "API Test", "username": username, "password": password}})
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
        no_such_user = gql_error(LOGIN, {"input": {"username": "no_such_user_x", "password": "nope-nope"}})
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
