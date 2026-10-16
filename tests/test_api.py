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
  activePrayerBurdens(personId: $personId) { id content person { id name } }
}"""


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
        assert by_id[a_burden]["person"] == {"__typename": "Person", "id": alice, "name": "Alice"}
        assert by_id[b_burden]["person"] == {"__typename": "Person", "id": bob, "name": "Bob"}

    def test_person_filter_returns_only_that_persons_burdens(self, make_user, status_id):
        token, _, _ = make_user()
        alice = create_person(token, status_id, name="Alice")
        bob = create_person(token, status_id, name="Bob")
        a_burden = self.burden(token, alice, "for alice")
        self.burden(token, bob, "for bob")

        rows = gql(PRAYER_LIST, {"personId": alice}, token)["activePrayerBurdens"]
        assert [r["id"] for r in rows] == [a_burden]
        assert rows[0]["person"] == {"__typename": "Person", "id": alice, "name": "Alice"}

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


# ── Contact cadence (business rule 6) ────────────────────────

LOG_CONTACT = """
mutation LogContact($input: LogContactInput!) {
  logContact(input: $input) {
    id contactState contactDueAt lastContactedAt lastContactDate status { name }
    contacts { id isFollowUp note contactedBy { id } }
    comments { content prayerBurden { id } author { id } }
  }
}"""

DELETE_CONTACT = """
mutation DeleteContact($id: UUID!) {
  deleteContact(id: $id) { id contactState contacts { id } comments { content } }
}"""

CONTACT_ALERTS = "query { contactAlerts { id name contactState contactDueAt } }"


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

        person = gql(LOG_CONTACT, {"input": {"personId": person_id, "note": "Phone call"}}, token)["logContact"]
        assert person["contactState"] == "ON_TRACK"
        assert person["lastContactedAt"] is not None
        [contact] = person["contacts"]
        assert (contact["isFollowUp"], contact["note"], contact["contactedBy"]["id"]) == (False, "Phone call", user_id)
        assert gql(CONTACT_ALERTS, token=token)["contactAlerts"] == []

    def test_contact_note_is_a_standalone_comment_removed_on_undo(self, make_user, statuses):
        token, user_id, _ = make_user()
        person_id = create_person(token, statuses["active"])
        person = gql(LOG_CONTACT, {"input": {"personId": person_id, "note": "Coffee"}}, token)["logContact"]
        [note] = person["comments"]
        assert (note["content"], note["prayerBurden"], note["author"]["id"]) == ("Coffee", None, user_id)

        person = gql(DELETE_CONTACT, {"id": person["contacts"][0]["id"]}, token)["deleteContact"]
        assert person["comments"] == []

    def test_contact_without_note_adds_no_comment(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        person = gql(LOG_CONTACT, {"input": {"personId": person_id, "note": "  "}}, token)["logContact"]
        assert person["contacts"][0]["note"] is None
        assert person["comments"] == []

    def test_follow_up_promotes_new_contact(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["new contact"])
        person = gql(LOG_CONTACT, {"input": {"personId": person_id, "isFollowUp": True}}, token)["logContact"]
        assert person["status"]["name"] == "active"
        assert person["contacts"][0]["isFollowUp"] is True

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

        gql(LOG_CONTACT, {"input": {"personId": person_id}}, coleader)
        for token in (owner, coleader):
            assert gql(CONTACT_ALERTS, token=token)["contactAlerts"] == []

    def test_delete_contact_restores_previous_state(self, make_user, statuses, backdate):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        backdate(person_id, 10)
        logged = gql(LOG_CONTACT, {"input": {"personId": person_id}}, token)["logContact"]
        person = gql(DELETE_CONTACT, {"id": logged["contacts"][0]["id"]}, token)["deleteContact"]
        assert person["contactState"] == "OVERDUE"
        assert person["contacts"] == []

    def test_stranger_cannot_log_or_delete_contacts(self, make_user, statuses):
        owner, _, _ = make_user()
        stranger, _, _ = make_user()
        person_id = create_person(owner, statuses["active"])
        error = gql_error_full(LOG_CONTACT, {"input": {"personId": person_id}}, stranger)
        assert error["extensions"]["code"] == "NOT_FOUND"

        logged = gql(LOG_CONTACT, {"input": {"personId": person_id}}, owner)["logContact"]
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
        error = gql_error_full(LOG_CONTACT, {"input": {"personId": person_id, "contactedAt": contacted_at}}, token)
        assert error["extensions"]["code"] == "BAD_USER_INPUT"

    def test_backdated_contact(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        person = gql(LOG_CONTACT, {"input": {"personId": person_id, "contactedAt": "2026-01-05T10:00:00Z"}}, token)[
            "logContact"
        ]
        assert person["lastContactDate"] == "2026-01-05"
        assert person["contactState"] == "OVERDUE"

    def test_deprecated_last_contact_date_logs_a_contact(self, make_user, statuses):
        token, _, _ = make_user()
        person_id = create_person(token, statuses["active"])
        gql(
            "mutation U($id: UUID!, $input: UpdatePersonInput!) { updatePerson(id: $id, input: $input) { id } }",
            {"id": person_id, "input": {"lastContactDate": "2026-01-05"}},
            token,
        )
        person = gql(
            "query P($id: UUID!) { person(id: $id) { lastContactDate contacts { id } } }", {"id": person_id}, token
        )["person"]
        assert person["lastContactDate"] == "2026-01-05"
        assert len(person["contacts"]) == 1
