"""
The sample dataset: a few shepherds and the people they care for.

Everything is hand-written so tests can rely on it. Dates are offsets
from today ("days_ago") rather than fixed dates, so the demo never looks
stale. Keys ("maria", "shepherd") are stable names tests look rows up by.

The data deliberately covers every business rule in CLAUDE.md:
  - a user with zero people              → "newuser"
  - a person with zero milestones,
    burdens and comments                 → "just_met"
  - a prayer burden with zero comments   → "aisha_settling"
  - standalone and burden-linked comments
  - a person shared by two shepherds     → "maria", "david", "elena"
  - every contact state (business rule 6). Contact offsets stay clear of
    the 72-hour, 7-day and "due soon" boundaries so states are stable:
      on track     → "maria", "rachel", "just_met" (new, never contacted)
      due soon     → "david", "hannah", "aisha"
      overdue      → "elena", "james", "priya", "marcus", "ben"
      not tracked  → "kenji", "lucy", "omar", "sofia"
"""

from typing import NamedTuple


class User(NamedTuple):
    key: str
    username: str  # prefixed at seed time, see seed.py
    name: str


class Person(NamedTuple):
    key: str
    name: str
    status: str
    shepherds: tuple[str, ...]
    age: int | None = None
    years_since_met: int | None = None
    last_contact_days_ago: float | None = None  # logged as one contact; None = never contacted
    is_active: bool = True


class Milestone(NamedTuple):
    person: str
    milestone: str
    recorded_by: str
    days_ago: int | None = None
    notes: str | None = None


class Burden(NamedTuple):
    key: str
    person: str
    content: str
    days_ago: int
    released_days_ago: int | None = None


class Comment(NamedTuple):
    person: str
    user: str
    content: str
    days_ago: int
    burden: str | None = None


USERS = [
    User("shepherd", "shepherd", "Daniel Okafor"),
    User("coleader", "coleader", "Grace Lin"),
    User("newuser", "newuser", "Sam Rivera"),
]

PEOPLE = [
    # Daniel and Grace share these three.
    Person("maria", "Maria Santos", "active", ("shepherd", "coleader"), 34, 6, 3),
    Person("david", "David Mensah", "active", ("shepherd", "coleader"), 52, 10, 6.5),
    Person("elena", "Elena Petrova", "active", ("shepherd", "coleader"), 29, 2, 21),
    # Daniel only.
    Person("james", "James Whitfield", "active", ("shepherd",), 27, 3, 10),
    Person("aisha", "Aisha Bello", "new contact", ("shepherd",), 22, 0, 2.5),
    Person("just_met", "Tom Becker", "new contact", ("shepherd",), years_since_met=0),
    Person("priya", "Priya Natarajan", "active", ("shepherd",), 41, 8, 14),
    Person("kenji", "Kenji Watanabe", "inactive", ("shepherd",), 30, 5, 120, is_active=False),
    Person("lucy", "Lucy Hartmann", "lost contact", ("shepherd",), 19, 4, 540, is_active=False),
    Person("marcus", "Marcus Reid", "new contact", ("shepherd",), 35, 1, 30),
    Person("hannah", "Hannah Cho", "active", ("shepherd",), None, 3, 5.5),
    Person("omar", "Omar Haddad", "inactive", ("shepherd",), 45, 7, 200, is_active=False),
    # Grace only.
    Person("rachel", "Rachel Adeyemi", "active", ("coleader",), 24, 2, 4),
    Person("ben", "Ben Nguyen", "new contact", ("coleader",), 31, 0, 9),
    Person("sofia", "Sofia Morales", "lost contact", ("coleader",), 38, 9, 900, is_active=False),
]

MILESTONES = [
    Milestone("maria", "baptised", "shepherd", 1900, "Baptised at the Easter service with her sister."),
    Milestone("maria", "joined small group", "shepherd", 1500),
    Milestone("maria", "serving", "coleader", 400, "Helping on the welcome team most Sundays."),
    Milestone("david", "baptised", "shepherd", 3400),
    Milestone("david", "serving", "shepherd", 2600, "Sound desk."),
    Milestone("david", "leading", "coleader", 700, "Co-leading the Thursday men's group."),
    Milestone("elena", "joined small group", "coleader", 300),
    Milestone("james", "baptised", "shepherd", 600, "Asked to be baptised after the summer camp."),
    Milestone("james", "joined small group", "shepherd", 900),
    Milestone("priya", "baptised", "shepherd", 2800),
    Milestone("priya", "joined small group", "shepherd", 2500),
    Milestone("priya", "serving", "shepherd", 1800, "Kids' ministry."),
    Milestone("priya", "leading", "shepherd", 60, "Started leading a new young mums' group."),
    Milestone("kenji", "baptised", "shepherd", 1400),
    Milestone("hannah", "baptised", "shepherd"),  # date unknown
    Milestone("omar", "joined small group", "shepherd", 2300),
    Milestone("rachel", "joined small group", "coleader", 500),
    Milestone("rachel", "serving", "coleader", 120, "Joined the worship team."),
    Milestone("sofia", "baptised", "coleader", 3000),
]

BURDENS = [
    Burden("maria_mother", "maria", "Her mother's health — waiting on test results from the hospital.", 25),
    Burden(
        "maria_work", "maria", "Wisdom about whether to accept the promotion and relocate.", 200, released_days_ago=150
    ),
    Burden("david_marriage", "david", "Strength and patience in his marriage during a hard season.", 60),
    Burden("david_son", "david", "His son starting university far from home.", 400, released_days_ago=330),
    Burden("elena_anxiety", "elena", "Peace with ongoing anxiety; she has started seeing a counsellor.", 40),
    Burden("james_job", "james", "Finding a job after being laid off.", 120, released_days_ago=45),
    Burden("aisha_settling", "aisha", "Settling into a new city and finding friends.", 2),
    Burden("priya_group", "priya", "Wisdom leading her first group.", 55),
    Burden("priya_visa", "priya", "Her parents' visa application to visit.", 700, released_days_ago=610),
    Burden("hannah_exams", "hannah", "Final exams next month.", 12),
    Burden("lucy_family", "lucy", "Reconciliation with her father.", 600),
    Burden("rachel_visa", "rachel", "Work visa renewal is due in the spring.", 30),
]

COMMENTS = [
    # A burden discussed at length by both shepherds.
    Comment(
        "maria", "shepherd", "Maria shared after church that her mum has been having dizzy spells.", 25, "maria_mother"
    ),
    Comment("maria", "coleader", "Dropped off a meal on Tuesday. Her mum was in good spirits.", 18, "maria_mother"),
    Comment("maria", "shepherd", "Tests came back inconclusive — more scans scheduled.", 9, "maria_mother"),
    Comment(
        "maria",
        "coleader",
        "Long chat over coffee. She's feeling stretched between caring for her mum, work and the welcome "
        "team, and wondered about stepping back from serving for a few months. I encouraged her that it's "
        "fine to rest for a season and that the team would cover. She also mentioned her sister might move "
        "in to help, which would take a lot of pressure off. Follow up in two weeks.",
        3,
        "maria_mother",
    ),
    Comment("maria", "shepherd", "Decided to take the promotion but stay put — remote role.", 150, "maria_work"),
    Comment("maria", "shepherd", "Great to see her and her sister at the barbecue.", 40),
    Comment("david", "coleader", "Asked us to keep this one quiet.", 58, "david_marriage"),
    Comment("david", "shepherd", "Settled in well; called home every week this term.", 330, "david_son"),
    Comment("elena", "coleader", "First counselling session went well.", 20, "elena_anxiety"),
    Comment("elena", "shepherd", "Hasn't been at small group the last two weeks — text her.", 21),
    Comment("james", "shepherd", "Two interviews this week.", 70, "james_job"),
    Comment("james", "shepherd", "Got the job! Starts on Monday.", 45, "james_job"),
    Comment("priya", "shepherd", "First group night had six mums turn up.", 50, "priya_group"),
    Comment("kenji", "shepherd", "Moved across town; looking for a church closer to home.", 120),
    Comment("lucy", "shepherd", "Moved away for university. Number may have changed.", 540),
    Comment("marcus", "shepherd", "Met at the community dinner. Into cycling.", 30),
    Comment("marcus", "shepherd", "Came along to the Sunday service with a friend.", 16),
    Comment("hannah", "shepherd", "Studying hard.", 12, "hannah_exams"),
    Comment("rachel", "coleader", "Lawyer says the paperwork looks fine.", 10, "rachel_visa"),
    Comment("ben", "coleader", "New neighbour — invited him to the Christmas carols.", 9),
]
