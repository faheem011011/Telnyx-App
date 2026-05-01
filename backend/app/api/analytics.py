"""Analytics endpoint — KPI aggregations for the dashboard."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Call, Contact, Message, User
from app.services.deps import get_current_user, require_admin

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# Hard cap: never pull more than this many rows into Python for time-series work.
# Summary stats use pure SQL COUNT and are unaffected by this limit.
_MAX_ROWS = 5_000

# US area code → "City, ST"  (NPA lookup table)
_AREA_CODE_GEO: dict[str, str] = {
    "201":"Jersey City, NJ","202":"Washington, DC","203":"New Haven, CT",
    "207":"Portland, ME","212":"New York, NY","213":"Los Angeles, CA",
    "214":"Dallas, TX","215":"Philadelphia, PA","216":"Cleveland, OH",
    "224":"Chicago, IL","225":"Baton Rouge, LA","228":"Gulfport, MS",
    "229":"Albany, GA","231":"Traverse City, MI","234":"Akron, OH",
    "239":"Fort Myers, FL","240":"Washington, DC","248":"Detroit, MI",
    "251":"Mobile, AL","252":"Rocky Mount, NC","253":"Tacoma, WA",
    "267":"Philadelphia, PA","269":"Kalamazoo, MI","272":"Scranton, PA",
    "276":"Bristol, VA","281":"Houston, TX","301":"Washington, DC",
    "302":"Wilmington, DE","303":"Denver, CO","304":"Charleston, WV",
    "305":"Miami, FL","307":"Cheyenne, WY","308":"Grand Island, NE",
    "309":"Peoria, IL","310":"Los Angeles, CA","312":"Chicago, IL",
    "313":"Detroit, MI","314":"St. Louis, MO","315":"Syracuse, NY",
    "316":"Wichita, KS","317":"Indianapolis, IN","318":"Shreveport, LA",
    "319":"Cedar Rapids, IA","320":"St. Cloud, MN","321":"Orlando, FL",
    "323":"Los Angeles, CA","325":"Abilene, TX","330":"Youngstown, OH",
    "331":"Chicago, IL","334":"Montgomery, AL","336":"Greensboro, NC",
    "337":"Lafayette, LA","339":"Boston, MA","346":"Houston, TX",
    "347":"New York, NY","352":"Gainesville, FL","360":"Bellingham, WA",
    "361":"Corpus Christi, TX","385":"Salt Lake City, UT",
    "386":"Daytona Beach, FL","401":"Providence, RI","402":"Omaha, NE",
    "404":"Atlanta, GA","405":"Oklahoma City, OK","406":"Billings, MT",
    "407":"Orlando, FL","408":"San Jose, CA","409":"Beaumont, TX",
    "410":"Baltimore, MD","412":"Pittsburgh, PA","413":"Springfield, MA",
    "414":"Milwaukee, WI","415":"San Francisco, CA","417":"Springfield, MO",
    "419":"Toledo, OH","423":"Chattanooga, TN","424":"Los Angeles, CA",
    "425":"Seattle, WA","430":"Tyler, TX","432":"Midland, TX",
    "434":"Charlottesville, VA","435":"St. George, UT","440":"Cleveland, OH",
    "443":"Baltimore, MD","458":"Eugene, OR","463":"Indianapolis, IN",
    "469":"Dallas, TX","470":"Atlanta, GA","475":"New Haven, CT",
    "478":"Macon, GA","479":"Fayetteville, AR","480":"Phoenix, AZ",
    "484":"Philadelphia, PA","501":"Little Rock, AR","502":"Louisville, KY",
    "503":"Portland, OR","504":"New Orleans, LA","505":"Albuquerque, NM",
    "507":"Rochester, MN","508":"Worcester, MA","509":"Spokane, WA",
    "510":"Oakland, CA","512":"Austin, TX","513":"Cincinnati, OH",
    "515":"Des Moines, IA","516":"Nassau, NY","517":"Lansing, MI",
    "518":"Albany, NY","520":"Tucson, AZ","530":"Sacramento, CA",
    "531":"Omaha, NE","539":"Tulsa, OK","540":"Roanoke, VA",
    "541":"Eugene, OR","551":"Jersey City, NJ","559":"Fresno, CA",
    "561":"West Palm Beach, FL","562":"Long Beach, CA","563":"Davenport, IA",
    "567":"Toledo, OH","570":"Scranton, PA","571":"Washington, DC",
    "573":"Columbia, MO","574":"South Bend, IN","575":"Las Cruces, NM",
    "580":"Lawton, OK","585":"Rochester, NY","586":"Detroit, MI",
    "601":"Jackson, MS","602":"Phoenix, AZ","603":"Manchester, NH",
    "605":"Sioux Falls, SD","606":"Ashland, KY","607":"Binghamton, NY",
    "608":"Madison, WI","609":"Trenton, NJ","610":"Philadelphia, PA",
    "612":"Minneapolis, MN","614":"Columbus, OH","615":"Nashville, TN",
    "616":"Grand Rapids, MI","617":"Boston, MA","618":"Belleville, IL",
    "619":"San Diego, CA","620":"Dodge City, KS","623":"Phoenix, AZ",
    "626":"Pasadena, CA","628":"San Francisco, CA","629":"Nashville, TN",
    "630":"Chicago, IL","631":"Long Island, NY","636":"St. Louis, MO",
    "641":"Mason City, IA","646":"New York, NY","650":"San Francisco, CA",
    "651":"St. Paul, MN","657":"Anaheim, CA","659":"Birmingham, AL",
    "660":"Sedalia, MO","661":"Bakersfield, CA","662":"Tupelo, MS",
    "667":"Baltimore, MD","669":"San Jose, CA","678":"Atlanta, GA",
    "680":"Syracuse, NY","681":"Charleston, WV","682":"Fort Worth, TX",
    "689":"Orlando, FL","701":"Fargo, ND","702":"Las Vegas, NV",
    "703":"Washington, DC","704":"Charlotte, NC","706":"Augusta, GA",
    "707":"Santa Rosa, CA","708":"Chicago, IL","712":"Sioux City, IA",
    "713":"Houston, TX","714":"Anaheim, CA","715":"Wausau, WI",
    "716":"Buffalo, NY","717":"Harrisburg, PA","718":"New York, NY",
    "719":"Colorado Springs, CO","720":"Denver, CO","724":"Pittsburgh, PA",
    "725":"Las Vegas, NV","726":"San Antonio, TX","727":"St. Petersburg, FL",
    "731":"Jackson, TN","732":"Newark, NJ","734":"Ann Arbor, MI",
    "737":"Austin, TX","740":"Columbus, OH","747":"Los Angeles, CA",
    "754":"Fort Lauderdale, FL","757":"Virginia Beach, VA","760":"San Diego, CA",
    "762":"Augusta, GA","763":"Minneapolis, MN","765":"Lafayette, IN",
    "769":"Jackson, MS","770":"Atlanta, GA","772":"Port St. Lucie, FL",
    "773":"Chicago, IL","774":"Worcester, MA","775":"Reno, NV",
    "779":"Rockford, IL","781":"Boston, MA","785":"Topeka, KS",
    "786":"Miami, FL","801":"Salt Lake City, UT","802":"Burlington, VT",
    "803":"Columbia, SC","804":"Richmond, VA","805":"Oxnard, CA",
    "806":"Lubbock, TX","808":"Honolulu, HI","810":"Detroit, MI",
    "812":"Evansville, IN","813":"Tampa, FL","814":"Erie, PA",
    "815":"Rockford, IL","816":"Kansas City, MO","817":"Fort Worth, TX",
    "818":"Los Angeles, CA","828":"Asheville, NC","830":"San Antonio, TX",
    "831":"Salinas, CA","832":"Houston, TX","843":"Charleston, SC",
    "845":"Newburgh, NY","847":"Chicago, IL","848":"Newark, NJ",
    "850":"Tallahassee, FL","856":"Camden, NJ","857":"Boston, MA",
    "858":"San Diego, CA","859":"Lexington, KY","860":"Hartford, CT",
    "862":"Newark, NJ","863":"Lakeland, FL","864":"Greenville, SC",
    "865":"Knoxville, TN","870":"Jonesboro, AR","872":"Chicago, IL",
    "878":"Pittsburgh, PA","901":"Memphis, TN","903":"Tyler, TX",
    "904":"Jacksonville, FL","906":"Marquette, MI","907":"Anchorage, AK",
    "908":"Newark, NJ","909":"San Bernardino, CA","910":"Wilmington, NC",
    "912":"Savannah, GA","913":"Kansas City, KS","914":"Yonkers, NY",
    "915":"El Paso, TX","916":"Sacramento, CA","917":"New York, NY",
    "918":"Tulsa, OK","919":"Raleigh, NC","920":"Green Bay, WI",
    "925":"Concord, CA","928":"Phoenix, AZ","929":"New York, NY",
    "930":"Evansville, IN","931":"Clarksville, TN","936":"Huntsville, TX",
    "937":"Dayton, OH","938":"Huntsville, AL","940":"Wichita Falls, TX",
    "941":"Sarasota, FL","945":"Dallas, TX","947":"Detroit, MI",
    "949":"Irvine, CA","951":"Riverside, CA","952":"Minneapolis, MN",
    "954":"Fort Lauderdale, FL","956":"Laredo, TX","959":"Hartford, CT",
    "970":"Fort Collins, CO","971":"Portland, OR","972":"Dallas, TX",
    "973":"Newark, NJ","978":"Lowell, MA","979":"Bryan, TX",
    "980":"Charlotte, NC","984":"Raleigh, NC","985":"New Orleans, LA",
    "986":"Boise, ID","989":"Saginaw, MI",
}


def _ensure_aware(dt: datetime) -> datetime:
    if dt is None:
        return dt
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _get_window(range_str: str, start: str | None, end: str | None):
    now = datetime.now(timezone.utc)
    if range_str == "1d":
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end   = now.replace(hour=23, minute=59, second=59, microsecond=999999)
        return day_start, day_end
    deltas = {"7d": 7, "30d": 30, "90d": 90}
    if range_str in deltas:
        return now - timedelta(days=deltas[range_str]), now
    if range_str == "custom" and start and end:
        try:
            ps = datetime.fromisoformat(start.replace("Z", "+00:00"))
            pe = datetime.fromisoformat(end.replace("Z", "+00:00"))
            return _ensure_aware(ps), _ensure_aware(pe)
        except ValueError:
            pass
    return now - timedelta(days=7), now


def _extract_area_code(number: str) -> str:
    digits = "".join(c for c in (number or "") if c.isdigit())
    if len(digits) == 11 and digits[0] == "1":
        return digits[1:4]
    if len(digits) == 10:
        return digits[:3]
    if len(digits) > 6:
        return digits[:3]
    return "Unknown"


# ---------------------------------------------------------------------------
# SQL-level summary — no records loaded into RAM
# ---------------------------------------------------------------------------

def _summarize_sql(
    db: Session,
    target_ids: list[int],
    period_start: datetime,
    period_end: datetime,
    total_contacts: int,
    new_contacts: int,
    direction: str | None = None,
) -> dict:
    call_base = [
        Call.owner_id.in_(target_ids),
        Call.started_at >= period_start,
        Call.started_at < period_end,
    ]
    if direction:
        call_base.append(Call.direction == direction)

    def cc(*extra):
        return db.query(func.count(Call.id)).filter(*call_base, *extra).scalar() or 0

    total    = cc()
    inbound  = cc(Call.direction == "inbound")
    outbound = cc(Call.direction == "outbound")
    answered = cc(Call.status == "completed")
    missed   = cc(Call.status.in_(["missed", "no-answer"]))
    declined = cc(Call.status == "busy")
    vms      = cc(Call.voicemail_url.isnot(None))
    recs     = cc(Call.recording_url.isnot(None))
    starred  = cc(Call.is_starred.is_(True))

    msg_base = [
        Message.owner_id.in_(target_ids),
        Message.created_at >= period_start,
        Message.created_at < period_end,
    ]

    def mc(*extra):
        return db.query(func.count(Message.id)).filter(*msg_base, *extra).scalar() or 0

    total_msgs    = mc()
    unread_msgs   = mc(Message.is_read.is_(False))
    inbound_msgs  = mc(Message.direction == "inbound")
    outbound_msgs = mc(Message.direction == "outbound")

    return {
        "total_calls":       total,
        "inbound_calls":     inbound,
        "outbound_calls":    outbound,
        "answered_calls":    answered,
        "missed_calls":      missed,
        "declined_calls":    declined,
        "voicemails":        vms,
        "recordings":        recs,
        "starred_calls":     starred,
        "total_messages":    total_msgs,
        "unread_messages":   unread_msgs,
        "inbound_messages":  inbound_msgs,
        "outbound_messages": outbound_msgs,
        "total_contacts":    total_contacts,
        "new_contacts":      new_contacts,
        "answer_rate":   round(answered / total * 100, 1) if total else 0.0,
        "missed_rate":   round(missed   / total * 100, 1) if total else 0.0,
        "declined_rate": round(declined / total * 100, 1) if total else 0.0,
        "outbound_rate": round(outbound / total * 100, 1) if total else 0.0,
    }


# ---------------------------------------------------------------------------
# Lightweight column-only fetch for time-series (no full ORM objects)
# ---------------------------------------------------------------------------

def _fetch_call_rows(
    db: Session,
    target_ids: list[int],
    period_start: datetime,
    period_end: datetime,
    direction: str | None = None,
):
    """Return lightweight tuples with only the columns needed for time-series.

    Capped at _MAX_ROWS to prevent memory exhaustion on large datasets.
    """
    q = db.query(
        Call.started_at,
        Call.direction,
        Call.status,
        Call.from_number,
        Call.to_number,
        Call.voicemail_url,
        Call.recording_url,
        Call.is_starred,
    ).filter(
        Call.owner_id.in_(target_ids),
        Call.started_at >= period_start,
        Call.started_at < period_end,
    )
    if direction:
        q = q.filter(Call.direction == direction)
    return q.order_by(Call.started_at.desc()).limit(_MAX_ROWS).all()


@router.get("")
def get_analytics(
    period:     str        = Query("7d", alias="range"),
    start:      str | None = Query(None),
    end:        str | None = Query(None),
    direction:  str | None = Query(None),
    user_id:    int | None = Query(None),
    department: str | None = Query(None),
    utc_offset: int        = Query(0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    period_start, period_end = _get_window(period, start, end)
    period_length = period_end - period_start
    prev_start    = period_start - period_length
    prev_end      = period_start

    if current_user.role == "admin":
        if user_id:
            target_ids = [user_id]
        elif department:
            dept_users = db.query(User.id).filter(User.department == department).all()
            target_ids = [r[0] for r in dept_users] or [-1]
        else:
            all_users = db.query(User.id).filter(User.is_active == True).all()
            target_ids = [r[0] for r in all_users] or [-1]
    else:
        target_ids = [current_user.id]

    # Contact counts via SQL — no records loaded
    total_contacts = db.query(func.count(Contact.id)).filter(
        Contact.owner_id.in_(target_ids)
    ).scalar() or 0

    new_contacts = db.query(func.count(Contact.id)).filter(
        Contact.owner_id.in_(target_ids),
        Contact.created_at >= period_start,
        Contact.created_at < period_end,
    ).scalar() or 0

    blocked_contacts = db.query(func.count(Contact.id)).filter(
        Contact.owner_id.in_(target_ids),
        Contact.is_blocked.is_(True),
    ).scalar() or 0

    favorite_contacts = db.query(func.count(Contact.id)).filter(
        Contact.owner_id.in_(target_ids),
        Contact.is_favorite.is_(True),
    ).scalar() or 0

    # Summary stats — pure SQL COUNT, zero records in RAM
    summary      = _summarize_sql(db, target_ids, period_start, period_end, total_contacts, new_contacts, direction)
    prev_summary = _summarize_sql(db, target_ids, prev_start, prev_end, total_contacts, 0, direction)

    # Lightweight column-only rows for time-series (capped at _MAX_ROWS)
    call_rows = _fetch_call_rows(db, target_ids, period_start, period_end, direction)

    tz_delta = timedelta(minutes=max(-840, min(840, utc_offset)))

    def _local(dt: datetime) -> datetime:
        return _ensure_aware(dt) + tz_delta

    # ── Call volume by day ──────────────────────────────────────────────────
    day_map: dict = defaultdict(lambda: {"inbound": 0, "outbound": 0, "missed": 0, "declined": 0})
    for row in call_rows:
        key = _local(row.started_at).strftime("%Y-%m-%d")
        day_map[key][row.direction] += 1
        if row.status in ("missed", "no-answer"):
            day_map[key]["missed"] += 1
        if row.status == "busy":
            day_map[key]["declined"] += 1

    local_start = _ensure_aware(period_start) + tz_delta
    days_count = max(int(period_length.total_seconds() // 86400) + 1, 1)
    call_volume_by_day = []
    for i in range(min(days_count, 91)):
        d     = (local_start + timedelta(days=i)).strftime("%Y-%m-%d")
        entry = day_map.get(d, {"inbound": 0, "outbound": 0, "missed": 0, "declined": 0})
        call_volume_by_day.append({"date": d, **entry})

    # ── Calls by hour ───────────────────────────────────────────────────────
    hour_map: dict = defaultdict(lambda: {"inbound": 0, "outbound": 0, "missed": 0, "declined": 0})
    for row in call_rows:
        h = _local(row.started_at).hour
        hour_map[h][row.direction] += 1
        if row.status in ("missed", "no-answer"):
            hour_map[h]["missed"] += 1
        if row.status == "busy":
            hour_map[h]["declined"] += 1
    calls_by_hour = [
        {"hour": h, **hour_map.get(h, {"inbound": 0, "outbound": 0, "missed": 0, "declined": 0})}
        for h in range(24)
    ]

    # ── Calls by day of week ────────────────────────────────────────────────
    dow_map: dict = defaultdict(int)
    for row in call_rows:
        dow_map[_local(row.started_at).weekday()] += 1
    calls_by_dow = [{"day": DAY_NAMES[i], "count": dow_map.get(i, 0)} for i in range(7)]

    # ── Call type breakdown ─────────────────────────────────────────────────
    s = summary
    call_type_breakdown = [
        {"type": "Incoming",  "count": s["inbound_calls"],  "pct": round(s["inbound_calls"]  / s["total_calls"] * 100, 1) if s["total_calls"] else 0},
        {"type": "Outgoing",  "count": s["outbound_calls"], "pct": round(s["outbound_calls"] / s["total_calls"] * 100, 1) if s["total_calls"] else 0},
        {"type": "Missed",    "count": s["missed_calls"],   "pct": s["missed_rate"]},
        {"type": "Declined",  "count": s["declined_calls"], "pct": s["declined_rate"]},
    ]

    # ── Top area codes ──────────────────────────────────────────────────────
    area_map: dict = defaultdict(lambda: {"count": 0, "inbound": 0, "outbound": 0, "numbers": set()})
    for row in call_rows:
        num = row.from_number if row.direction == "inbound" else row.to_number
        ac  = _extract_area_code(num)
        if ac == "Unknown":
            continue
        area_map[ac]["count"]        += 1
        area_map[ac][row.direction]  += 1
        area_map[ac]["numbers"].add(num)

    top_area_codes = sorted(
        [
            {
                "area_code":      ac,
                "city_state":     _AREA_CODE_GEO.get(ac, f"Area {ac}"),
                "count":          data["count"],
                "inbound":        data["inbound"],
                "outbound":       data["outbound"],
                "unique_numbers": len(data["numbers"]),
            }
            for ac, data in area_map.items()
        ],
        key=lambda x: -x["count"],
    )[:3]

    # ── Recent messages (already limited to 20) ─────────────────────────────
    recent_raw = (
        db.query(
            Message.id,
            Message.direction,
            Message.from_number,
            Message.to_number,
            Message.body,
            Message.is_read,
            Message.created_at,
        )
        .filter(Message.owner_id.in_(target_ids))
        .order_by(Message.created_at.desc())
        .limit(20)
        .all()
    )
    msg_nums = {m.from_number if m.direction == "inbound" else m.to_number for m in recent_raw}
    name_cache: dict = {}
    if msg_nums:
        matched = db.query(Contact.phone_number, Contact.name).filter(
            Contact.owner_id.in_(target_ids),
            Contact.phone_number.in_(msg_nums),
        ).all()
        name_cache = {row.phone_number: row.name for row in matched}

    recent_messages = [
        {
            "id":           m.id,
            "direction":    m.direction,
            "from_number":  m.from_number,
            "to_number":    m.to_number,
            "body":         m.body,
            "is_read":      m.is_read,
            "created_at":   _ensure_aware(m.created_at).isoformat() if m.created_at else None,
            "contact_name": name_cache.get(
                m.from_number if m.direction == "inbound" else m.to_number
            ),
        }
        for m in recent_raw
    ]

    contacts_overview = {
        "total":     total_contacts,
        "new":       new_contacts,
        "blocked":   blocked_contacts,
        "favorites": favorite_contacts,
    }

    return {
        "summary":                 summary,
        "previous_period_summary": prev_summary,
        "call_volume_by_day":      call_volume_by_day,
        "calls_by_hour":           calls_by_hour,
        "calls_by_day_of_week":    calls_by_dow,
        "call_type_breakdown":     call_type_breakdown,
        "top_area_codes":          top_area_codes,
        "recent_messages":         recent_messages,
        "contacts_overview":       contacts_overview,
    }


@router.get("/users-summary")
def get_users_summary(
    period:     str        = Query("7d", alias="range"),
    start:      str | None = Query(None),
    end:        str | None = Query(None),
    user_id:    int | None = Query(None),
    department: str | None = Query(None),
    db:         Session    = Depends(get_db),
    _admin:     User       = Depends(require_admin),
):
    """Per-user metric rows used for CSV export (admin only)."""
    period_start, period_end = _get_window(period, start, end)

    user_q = db.query(User).filter(User.is_active.is_(True))
    if user_id:
        user_q = user_q.filter(User.id == user_id)
    elif department:
        user_q = user_q.filter(User.department == department)
    users = user_q.all()

    if not users:
        return []

    user_ids = [u.id for u in users]

    # Single GROUP BY query for all call stats — replaces N per-user q.all() calls
    call_stats_rows = db.query(
        Call.owner_id,
        func.count(Call.id).label("total_calls"),
        func.sum(case((Call.direction == "inbound",  1), else_=0)).label("incoming"),
        func.sum(case((Call.direction == "outbound", 1), else_=0)).label("outgoing"),
        func.sum(case((Call.status == "completed",   1), else_=0)).label("answered"),
        func.sum(case((Call.status.in_(["missed", "no-answer"]), 1), else_=0)).label("missed"),
        func.sum(case((Call.status == "busy",        1), else_=0)).label("declined"),
        func.sum(case((Call.voicemail_url.isnot(None), 1), else_=0)).label("voicemails"),
        func.sum(case((Call.recording_url.isnot(None), 1), else_=0)).label("recordings"),
    ).filter(
        Call.owner_id.in_(user_ids),
        Call.started_at >= period_start,
        Call.started_at < period_end,
    ).group_by(Call.owner_id).all()

    call_map = {row.owner_id: row for row in call_stats_rows}

    # Single GROUP BY query for all message stats
    msg_stats_rows = db.query(
        Message.owner_id,
        func.count(Message.id).label("total_messages"),
        func.sum(case((Message.is_read.is_(False), 1), else_=0)).label("unread_messages"),
    ).filter(
        Message.owner_id.in_(user_ids),
        Message.created_at >= period_start,
        Message.created_at < period_end,
    ).group_by(Message.owner_id).all()

    msg_map = {row.owner_id: row for row in msg_stats_rows}

    result = []
    for u in users:
        c = call_map.get(u.id)
        m = msg_map.get(u.id)
        result.append({
            "user_id":         u.id,
            "user_name":       u.name,
            "user_email":      u.email,
            "department":      u.department or "",
            "total_calls":     c.total_calls    if c else 0,
            "incoming":        c.incoming       if c else 0,
            "outgoing":        c.outgoing       if c else 0,
            "answered":        c.answered       if c else 0,
            "missed":          c.missed         if c else 0,
            "declined":        c.declined       if c else 0,
            "voicemails":      c.voicemails     if c else 0,
            "recordings":      c.recordings     if c else 0,
            "total_messages":  m.total_messages if m else 0,
            "unread_messages": m.unread_messages if m else 0,
        })

    return result
