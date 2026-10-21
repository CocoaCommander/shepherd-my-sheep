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
  - standalone and burden-linked comments, and contact notes: standalone
    comments linked to the contact they were written with (rule 5)
  - a person shared by two shepherds     → "maria", "david", "elena";
    the latest contact for "maria" and "elena" is by the co-shepherd,
    which clears the alert for both
  - milestones reached out of order      → "david", "elena", "rachel", "omar"
  - a new contact promoted to active by a follow-up → "rachel". She is
    created as a new contact and log_contact promotes her, as in the app.
  - new contacts with a first contact but no follow-up yet → "aisha",
    "marcus", "ben"
  - prayers by both shepherds of a shared person ("maria": last by the
    co-shepherd), one back-dated ("david"), a prayed-for person with no
    burdens ("marcus"), and people never prayed for ("just_met", "lucy")
  - every contact state (business rule 6). Each person's latest contact
    stays clear of the 72-hour, 7-day and "due soon" boundaries so states
    are stable:
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
    is_active: bool = True


class Contact(NamedTuple):
    person: str
    user: str
    days_ago: float  # fractional, so the demo can sit between the rule-6 boundaries
    is_follow_up: bool = False
    note: str | None = None  # saved as a standalone comment linked to the contact


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


class Prayer(NamedTuple):
    person: str
    user: str
    days_ago: float  # when they prayed
    logged_days_ago: float | None = None  # when it was recorded, if later (back-dated); default the same


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
    Person("maria", "Maria Santos", "active", ("shepherd", "coleader"), 34, 6),
    Person("david", "David Mensah", "active", ("shepherd", "coleader"), 52, 10),
    Person("elena", "Elena Petrova", "active", ("shepherd", "coleader"), 29, 2),
    # Daniel only.
    Person("james", "James Whitfield", "active", ("shepherd",), 27, 3),
    Person("aisha", "Aisha Bello", "new contact", ("shepherd",), 22, 0),
    Person("just_met", "Tom Becker", "new contact", ("shepherd",), years_since_met=0),
    Person("priya", "Priya Natarajan", "active", ("shepherd",), 41, 8),
    Person("kenji", "Kenji Watanabe", "inactive", ("shepherd",), 30, 5, is_active=False),
    Person("lucy", "Lucy Hartmann", "lost contact", ("shepherd",), 19, 4, is_active=False),
    Person("marcus", "Marcus Reid", "new contact", ("shepherd",), 35, 1),
    Person("hannah", "Hannah Cho", "active", ("shepherd",), None, 3),
    Person("omar", "Omar Haddad", "inactive", ("shepherd",), 45, 7, is_active=False),
    # Grace only.
    # Created as a new contact; her follow-up below promotes her (rule 6).
    Person("rachel", "Rachel Adeyemi", "active", ("coleader",), 24, 2),
    Person("ben", "Ben Nguyen", "new contact", ("coleader",), 31, 0),
    Person("sofia", "Sofia Morales", "lost contact", ("coleader",), 38, 9, is_active=False),
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
    Comment("marcus", "shepherd", "Came along to the Sunday service with a friend.", 16),
    Comment("hannah", "shepherd", "Studying hard.", 12, "hannah_exams"),
    Comment("rachel", "coleader", "Lawyer says the paperwork looks fine.", 10, "rachel_visa"),
]

# Oldest first per person; the latest one sets their contact state (see the
# module docstring). Notes that were said at a contact live here, not in
# COMMENTS.
CONTACTS = [
    Contact("maria", "shepherd", 10, note="Caught her after church; her mum's scans are next week."),
    Contact("maria", "coleader", 3),  # the coffee chat, written up on the burden
    Contact("david", "shepherd", 13.5),
    Contact("david", "coleader", 6.5, note="Caught up after the men's group."),
    Contact("elena", "shepherd", 35),
    Contact("elena", "coleader", 21),
    Contact("james", "shepherd", 45),
    Contact("james", "shepherd", 10, note="Settling into the new job and enjoying it."),
    Contact("aisha", "shepherd", 2.5, note="Met at the welcome lunch. Just moved here for work."),
    Contact("priya", "shepherd", 21),
    Contact("priya", "shepherd", 14),
    Contact("kenji", "shepherd", 120, note="Moved across town; looking for a church closer to home."),
    Contact("lucy", "shepherd", 540, note="Moved away for university. Number may have changed."),
    Contact("marcus", "shepherd", 30, note="Met at the community dinner. Into cycling."),
    Contact("hannah", "shepherd", 12.5),
    Contact("hannah", "shepherd", 5.5),
    Contact("omar", "shepherd", 200),
    Contact("rachel", "coleader", 700, note="Met at the student café night."),
    Contact("rachel", "coleader", 698, is_follow_up=True, note="Coffee; she wants to try a small group."),
    Contact("rachel", "coleader", 11),
    Contact("rachel", "coleader", 4),
    Contact("ben", "coleader", 9, note="New neighbour — invited him to the Christmas carols."),
    Contact("sofia", "coleader", 900),
]

# Praying is not a contact: none of these change anyone's contact state.
PRAYERS = [
    Prayer("maria", "shepherd", 6),
    Prayer("maria", "coleader", 4.2),
    Prayer("maria", "shepherd", 2.1),
    Prayer("maria", "coleader", 1.1),
    Prayer("david", "coleader", 9),
    Prayer("david", "shepherd", 5, logged_days_ago=3),  # back-dated: forgot to log it
    Prayer("elena", "coleader", 0.1),
    Prayer("aisha", "shepherd", 1.5),
    Prayer("marcus", "shepherd", 12),  # no burdens (business rule 3)
    Prayer("priya", "shepherd", 20),
    Prayer("rachel", "coleader", 2),
]
