"""KBC Nursing MediMath — 간호학과 임상실습 배치 관리 서버.

- 데이터: SQLite (DATA_DIR/clinic.db). Railway에서는 Volume을 DATA_DIR에 연결한다.
- 접근: 학부장, 임상산학학과장, 임상실습주임교수, 임상실습행정직원 계정만 로그인할 수 있다.
- 계정은 직위별로 두고, 발령으로 사람이 바뀌면 이름을 고치고 비밀번호를 초기화한다.
"""
import datetime
import functools
import json
import os
import secrets
import sqlite3
import time

from flask import Flask, g, jsonify, redirect, render_template, request, session, Response
from werkzeug.security import check_password_hash, generate_password_hash

ROLES = ["학부장", "임상산학학과장", "임상실습주임교수", "임상실습행정직원"]
# 이전 이름 → 현재 이름
ROLE_RENAMES = {"임상실습학과장": "임상산학학과장", "임상실습직원": "임상실습행정직원"}
# 계정을 만들고 지울 수 있는 직위
MANAGER_ROLES = {"학부장", "임상산학학과장", "임상실습주임교수"}
COURSES = ["adult", "women", "child"]
MAXP = 6  # 학기당 2주 단위 기간 최대 개수

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(BASE_DIR, "data")
PERSISTENT = bool(os.environ.get("DATA_DIR"))
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "clinic.db")


def _secret_key():
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = os.path.join(DATA_DIR, "secret_key")
    try:
        with open(path) as f:
            return f.read().strip()
    except FileNotFoundError:
        key = secrets.token_hex(32)
        try:
            with open(path, "x") as f:
                f.write(key)
        except FileExistsError:
            with open(path) as f:
                return f.read().strip()
        return key


app = Flask(__name__)


def _asset_version():
    """화면 파일 내용으로 만든 버전값. 배포하면 바뀌므로 브라우저가 새 파일을 받는다."""
    import hashlib
    h = hashlib.md5()
    for name in ("app.js", "engine.js", "style.css"):
        try:
            with open(os.path.join(BASE_DIR, "static", name), "rb") as f:
                h.update(f.read())
        except OSError:
            pass
    return h.hexdigest()[:10]


ASSET_VER = _asset_version()


@app.context_processor
def _inject_ver():
    return {"v": ASSET_VER}


@app.after_request
def _no_cache_pages(resp):
    if resp.mimetype == "text/html":
        resp.headers["Cache-Control"] = "no-store"
    return resp
app.secret_key = _secret_key()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=bool(os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("COOKIE_SECURE")),
    PERMANENT_SESSION_LIFETIME=datetime.timedelta(hours=12),
    MAX_CONTENT_LENGTH=20 * 1024 * 1024,
    JSON_AS_ASCII=False,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, login_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL, pw_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS institutions(
  id INTEGER PRIMARY KEY, course TEXT NOT NULL, name TEXT NOT NULL, short TEXT NOT NULL DEFAULT '',
  kw TEXT NOT NULL DEFAULT '', caps TEXT NOT NULL DEFAULT '[0,0,0,0]',
  grade INTEGER NOT NULL DEFAULT 0, female INTEGER NOT NULL DEFAULT 0, local INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS wards(
  id INTEGER PRIMARY KEY, institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS students(
  id INTEGER PRIMARY KEY, student_no TEXT UNIQUE NOT NULL, name TEXT NOT NULL, sex TEXT NOT NULL DEFAULT '여',
  gpa REAL, age INTEGER, addr TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS cohorts(
  id INTEGER PRIMARY KEY, year3 INTEGER UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS exclusions(
  id INTEGER PRIMARY KEY, term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  periods TEXT NOT NULL DEFAULT '[]', reason TEXT NOT NULL DEFAULT '', UNIQUE(term_id, student_id));
CREATE TABLE IF NOT EXISTS pins(
  id INTEGER PRIMARY KEY, term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  period INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '', UNIQUE(term_id, student_id, period));
CREATE TABLE IF NOT EXISTS term_log(
  id INTEGER PRIMARY KEY, term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  action TEXT NOT NULL, user_name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS courses(
  id INTEGER PRIMARY KEY, term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  name TEXT NOT NULL, units INTEGER NOT NULL DEFAULT 1, consecutive INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS terms(
  id INTEGER PRIMARY KEY, label TEXT UNIQUE NOT NULL, periods TEXT NOT NULL DEFAULT '[]', sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS placements(
  id INTEGER PRIMARY KEY, term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, period TEXT NOT NULL DEFAULT '', institution TEXT NOT NULL,
  course TEXT NOT NULL DEFAULT '', ward TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_pl_term ON placements(term_id);
CREATE INDEX IF NOT EXISTS ix_pl_student ON placements(student_id);
CREATE INDEX IF NOT EXISTS ix_wards_inst ON wards(institution_id);
"""

# 2026-2학기 배치표 기준 기본 기관·정원·병동
SEED_INSTITUTIONS = [
    ("adult", "강동경희대학교병원", "강동경희", "서울", [24, 24, 24, 24], "7A병동|7B병동|8A병동|12B병동|8B병동|6A병동|응급실|회복실|수술실", "g"),
    ("adult", "경희의료원", "경희의료원", "서울", [0, 0, 0, 0], "", "g"),
    ("adult", "삼성창원병원", "삼성창원", "창원, 김해", [8, 8, 8, 8], "82병동|91병동|92병동|EICU", "g"),
    ("adult", "이대서울병원", "이대서울", "서울", [8, 8, 8, 8], "93병동|EICU", "g"),
    ("adult", "서남병원", "서남", "서울", [7, 7, 7, 7], "재활의학과(52병동)|중환자실", ""),
    ("adult", "부평세림병원", "부평세림", "인천, 부평", [8, 8, 8, 8], "정형외과(8병동)|외과(6병동)|외과/내과(5A)|내과(5B)", ""),
    ("adult", "한양대구리병원", "한양구리", "구리, 남양주", [6, 6, 6, 6], "102병동|72병동|MICU", ""),
    ("adult", "안동병원", "안동", "안동, 영주", [8, 8, 8, 8], "114본관|104본관|104남관|104서관", "l"),
    ("adult", "안동성소병원", "안동성소", "안동, 영주", [12, 12, 11, 11], "내과(A6)|인공신장실|응급실|중환자실|정형외과(B7)|외과(B8)", "l"),
    ("women", "아인병원", "아인", "인천", [8, 6, 4, 4], "12병동|수술실", "f"),
    ("women", "에이치큐브병원", "에이치큐브", "", [8, 7, 7, 8], "6층병동", "f"),
    ("women", "안산단원병원", "안산단원", "안산", [7, 5, 6, 6], "산부인과(8병동)", ""),
    ("women", "한림병원", "한림", "인천", [6, 8, 8, 8], "산부인과(41병동)|산부인과(42병동)", ""),
    ("women", "안동병원", "안동", "안동, 영주", [5, 7, 8, 8], "분만간호파트|74동관간호파트", "l"),
    ("women", "안동성소병원", "안동성소", "안동, 영주", [6, 7, 7, 7], "산부인과(A4)|산부인과(A7)", "l"),
    ("child", "서울어린이병원", "서울어린이", "서울", [5, 5, 5, 6], "32병동|33병동|34병동|41병동|42병동|43병동", ""),
    ("child", "다보스병원", "다보스", "용인", [5, 6, 6, 6], "소아청소년과(10병동)", ""),
    ("child", "원주의료원", "원주", "원주", [6, 6, 6, 6], "소아청소년과(42병동)", ""),
    ("child", "부평세림병원", "부평세림", "인천, 부평", [6, 6, 7, 5], "소아청소년과(천사병동)", ""),
    ("child", "안동병원", "안동", "안동, 영주", [6, 6, 5, 5], "64남관간호파트", "l"),
    ("child", "안동성소병원", "안동성소", "안동, 영주", [12, 11, 12, 12], "본관6병동|신관B6병동", "l"),
]
# 기수: 'year3'년에 3학년인 학생들. 3학년 1·2학기(year3)와 4학년 1학기(year3+1)를 함께 본다.
TERM_KINDS = [("3-1", "3학년 1학기", 0, 1), ("3-2", "3학년 2학기", 0, 2), ("4-1", "4학년 1학기", 1, 1)]
SEED_PERIODS = {
    (2026, "3-1"): ["03/02-03/13", "03/16-03/27", "03/30-04/10", ""],
    (2026, "3-2"): ["10/12-10/23", "10/26-11/06", "11/09-11/20", "11/23-12/04"],
}


# 학기별 기본 교과목: (이름, 2주 단위 수, 연속 여부)
DEFAULT_COURSES = {
    "3-1": [("성인간호학실습(1)", 2, 0), ("노인간호학실습", 1, 0)],
    "3-2": [("성인간호학실습(2)", 2, 1), ("여성건강간호학실습", 1, 0), ("아동간호학실습", 1, 0)],
    "4-1": [("성인간호학실습(3)", 1, 0), ("간호관리학실습", 1, 0), ("정신간호학실습", 1, 0)],
}


def term_label(year3, kind):
    for k, name, dy, sem in TERM_KINDS:
        if k == kind:
            return f"{name} ({year3 + dy}-{sem})"
    try:
        g, sem = [int(x) for x in kind.split("-")]
        return f"{g}학년 {sem}학기 ({year3 + g - 3}-{sem})"
    except ValueError:
        return kind


def ensure_courses(con, term_id, kind):
    if con.execute("SELECT COUNT(*) FROM courses WHERE term_id=?", (term_id,)).fetchone()[0]:
        return
    for i, (name, units, consec) in enumerate(DEFAULT_COURSES.get(kind, [])):
        con.execute("INSERT INTO courses(term_id,name,units,consecutive,sort) VALUES(?,?,?,?,?)", (term_id, name, units, consec, i + 1))


def create_cohort(con, year3, name=""):
    cur = con.execute("INSERT INTO cohorts(year3,name) VALUES(?,?)", (year3, name))
    cid = cur.lastrowid
    for i, (kind, _n, _dy, _sem) in enumerate(TERM_KINDS):
        label = term_label(year3, kind)
        ex = con.execute("SELECT id FROM terms WHERE label=?", (label,)).fetchone()
        if ex:  # 이전 버전에서 만든 같은 학기는 이 기수로 옮김
            con.execute("UPDATE terms SET cohort_id=?,kind=?,sort=? WHERE id=?", (cid, kind, i + 1, ex[0]))
            tid = ex[0]
        else:
            tid = con.execute("INSERT INTO terms(label,periods,sort,cohort_id,kind) VALUES(?,?,?,?,?)",
                              (label, json.dumps(SEED_PERIODS.get((year3, kind), ["", "", "", ""]), ensure_ascii=False), i + 1, cid, kind)).lastrowid
        if con.execute("SELECT 1 FROM sqlite_master WHERE name='courses'").fetchone():
            ensure_courses(con, tid, kind)
    return cid


SEED_TERMS = [
    ("3학년 1학기 (2026-1)", ["03/02-03/13", "03/16-03/27", "03/30-04/10", ""], 1),
    ("3학년 2학기 (2026-2)", ["10/12-10/23", "10/26-11/06", "11/09-11/20", "11/23-12/04"], 2),
    ("4학년 1학기 (2027-1)", ["", "", "", ""], 3),
]
DEFAULT_WEIGHTS = {"grade": 80, "local": 100, "age": 60, "addr": 30, "ageCut": 35, "same": 50}


def initial_accounts():
    """첫 시작 때 만들 계정.

    INIT_ACCOUNTS = "아이디|직위|이름;아이디|직위|이름;..." 와 INIT_PASSWORD(처음 비밀번호, 모두 같음).
    처음 로그인하면 각자 비밀번호를 바꿔야 한다. 예전 방식(ADMIN_LOGIN/ADMIN_PASSWORD)도 받는다.
    """
    pw = os.environ.get("INIT_PASSWORD") or os.environ.get("ADMIN_PASSWORD")
    if not pw:
        return []
    out = []
    for part in (os.environ.get("INIT_ACCOUNTS") or "").split(";"):
        bits = [b.strip() for b in part.split("|")]
        if len(bits) >= 2 and bits[0]:
            role = ROLE_RENAMES.get(bits[1], bits[1])
            if role in ROLES:
                out.append((bits[0], role, bits[2] if len(bits) > 2 and bits[2] else role, pw))
    if not out:
        role = ROLE_RENAMES.get(os.environ.get("ADMIN_ROLE", ""), os.environ.get("ADMIN_ROLE", ""))
        out.append((os.environ.get("ADMIN_LOGIN", "admin").strip(), role if role in ROLES else "임상실습주임교수",
                    os.environ.get("ADMIN_NAME", "관리자"), pw))
    return out


def init_db():
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.isolation_level = None
    try:
        con.execute("PRAGMA journal_mode=WAL")
        con.executescript(SCHEMA)
        con.execute("BEGIN IMMEDIATE")
        if con.execute("SELECT COUNT(*) FROM institutions").fetchone()[0] == 0 and \
                con.execute("SELECT value FROM settings WHERE key='seeded'").fetchone() is None:
            for i, (course, name, short, kw, caps, wards, flags) in enumerate(SEED_INSTITUTIONS):
                cur = con.execute(
                    "INSERT INTO institutions(course,name,short,kw,caps,grade,female,local,sort) VALUES(?,?,?,?,?,?,?,?,?)",
                    (course, name, short, kw, json.dumps(caps), int("g" in flags), int("f" in flags), int("l" in flags), i))
                for j, w in enumerate([w for w in wards.split("|") if w]):
                    con.execute("INSERT INTO wards(institution_id,name,sort) VALUES(?,?,?)", (cur.lastrowid, w, j))
            con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('weights',?)", (json.dumps(DEFAULT_WEIGHTS),))
            con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('seeded','1')")
        # 기수 구조로 옮기기 (이전 버전 데이터는 2026년 3학년 기수로)
        scols = [r[1] for r in con.execute("PRAGMA table_info(students)")]
        if "cohort_id" not in scols:
            con.execute("ALTER TABLE students ADD COLUMN cohort_id INTEGER REFERENCES cohorts(id)")
        tcols = [r[1] for r in con.execute("PRAGMA table_info(terms)")]
        if "cohort_id" not in tcols:
            con.execute("ALTER TABLE terms ADD COLUMN cohort_id INTEGER REFERENCES cohorts(id) ON DELETE CASCADE")
        if "kind" not in tcols:
            con.execute("ALTER TABLE terms ADD COLUMN kind TEXT NOT NULL DEFAULT ''")
        for col in ("status", "status_note", "status_by", "status_at"):  # 승인 상태
            if col not in tcols:
                dflt = "draft" if col == "status" else ""
                con.execute(f"ALTER TABLE terms ADD COLUMN {col} TEXT NOT NULL DEFAULT '{dflt}'")
        if con.execute("SELECT COUNT(*) FROM cohorts").fetchone()[0] == 0:
            c26 = create_cohort(con, 2026)
            create_cohort(con, 2027)
            con.execute("UPDATE students SET cohort_id=? WHERE cohort_id IS NULL", (c26,))
            con.execute("UPDATE terms SET cohort_id=?,kind='etc',sort=10+id WHERE cohort_id IS NULL", (c26,))
        # 학기별 교과목 구조로 옮기기: 기관은 학기의 교과목에 속한다. 이전 기관은 2026년 3학년 2학기로
        icols = [r[1] for r in con.execute("PRAGMA table_info(institutions)")]
        if "course_id" not in icols:
            con.execute("ALTER TABLE institutions ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE")
        if con.execute("SELECT value FROM settings WHERE key='courses_v1'").fetchone() is None:
            for tid, kind in con.execute("SELECT id,kind FROM terms").fetchall():
                ensure_courses(con, tid, kind)
            t32 = con.execute("SELECT t.id FROM terms t JOIN cohorts c ON c.id=t.cohort_id WHERE c.year3=2026 AND t.kind='3-2'").fetchone()
            if t32:
                cmap = {r[1]: r[0] for r in con.execute("SELECT id,name FROM courses WHERE term_id=?", (t32[0],))}
                for old, name in (("adult", "성인간호학실습(2)"), ("women", "여성건강간호학실습"), ("child", "아동간호학실습")):
                    if name in cmap:
                        con.execute("UPDATE institutions SET course_id=? WHERE course=? AND course_id IS NULL", (cmap[name], old))
            con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('courses_v1','1')")
        cols = [r[1] for r in con.execute("PRAGMA table_info(users)")]
        if "must_change" not in cols:
            con.execute("ALTER TABLE users ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0")
        if "init_pw" not in cols:  # 처음 비밀번호를 아직 그대로 쓰는 계정 표시
            con.execute("ALTER TABLE users ADD COLUMN init_pw INTEGER NOT NULL DEFAULT 0")
            con.execute("UPDATE users SET init_pw=1 WHERE must_change=1")
        for old, new in ROLE_RENAMES.items():
            con.execute("UPDATE users SET role=? WHERE role=?", (new, old))
        if con.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
            for login, role, name, pw in initial_accounts():
                con.execute("INSERT INTO users(login_id,name,role,pw_hash,must_change,init_pw) VALUES(?,?,?,?,1,1)",
                            (login, name, role, generate_password_hash(pw)))
        else:
            # 처음 비밀번호를 아직 바꾸지 않은 계정은 지금의 INIT_PASSWORD를 따른다
            pw = os.environ.get("INIT_PASSWORD")
            if pw:
                for uid, h in con.execute("SELECT id,pw_hash FROM users WHERE init_pw=1").fetchall():
                    if not check_password_hash(h, pw):
                        con.execute("UPDATE users SET pw_hash=?,must_change=1 WHERE id=?", (generate_password_hash(pw), uid))
        con.execute("COMMIT")
    finally:
        con.close()


init_db()


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=30)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def _close(_exc):
    con = g.pop("db", None)
    if con is not None:
        con.close()


def err(msg, code=400):
    return jsonify(error=msg), code


def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    return db().execute("SELECT id,login_id,name,role,must_change FROM users WHERE id=?", (uid,)).fetchone()


def login_required(f):
    @functools.wraps(f)
    def wrapper(*a, **kw):
        u = current_user()
        if not u:
            session.clear()
            if request.path.startswith("/api/"):
                return err("로그인이 필요합니다.", 401)
            return redirect("/login")
        if request.path.startswith("/api/") and request.method != "GET" and \
                request.headers.get("X-Requested-With") != "fetch":
            return err("잘못된 요청입니다.", 400)
        g.user = u
        return f(*a, **kw)
    return wrapper


def manager_required(f):
    @functools.wraps(f)
    @login_required
    def wrapper(*a, **kw):
        if g.user["role"] not in MANAGER_ROLES:
            return err("계정 관리는 학부장, 임상산학학과장, 임상실습주임교수만 할 수 있습니다.", 403)
        return f(*a, **kw)
    return wrapper


def body():
    return request.get_json(silent=True) or {}


def to_float(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def to_int(v):
    f = to_float(v)
    return int(f) if f is not None else None


# ---------------------------------------------------------------- pages
@app.get("/healthz")
def healthz():
    return "ok"


@app.get("/login")
def login_page():
    if current_user():
        return redirect("/")
    return render_template("login.html", error=None, has_users=_has_users())


def _has_users():
    return db().execute("SELECT COUNT(*) FROM users").fetchone()[0] > 0


@app.post("/login")
def login_post():
    login_id = (request.form.get("login_id") or "").strip()
    pw = request.form.get("password") or ""
    u = db().execute("SELECT * FROM users WHERE login_id=?", (login_id,)).fetchone()
    if not u or not check_password_hash(u["pw_hash"], pw):
        time.sleep(0.6)
        return render_template("login.html", error="아이디 또는 비밀번호가 맞지 않습니다.", has_users=_has_users()), 401
    session.clear()
    session.permanent = True
    session["uid"] = u["id"]
    return redirect("/")


@app.get("/logout")
def logout():
    session.clear()
    return redirect("/login")


@app.get("/")
@login_required
def index():
    return render_template("index.html", user=g.user)


# ---------------------------------------------------------------- data
def institutions_payload():
    rows = db().execute("SELECT * FROM institutions ORDER BY sort,id").fetchall()
    wards = db().execute("SELECT * FROM wards ORDER BY sort,id").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["caps"] = json.loads(d["caps"])
        for k in ("grade", "female", "local"):
            d[k] = bool(d[k])
        d["wards"] = [{"id": w["id"], "name": w["name"]} for w in wards if w["institution_id"] == r["id"]]
        out.append(d)
    return out


def courses_payload():
    return [dict(r) for r in db().execute("SELECT * FROM courses ORDER BY term_id,sort,id")]


def clean_course(b, partial=False):
    out = {}
    if "name" in b or not partial:
        v = str(b.get("name") or "").strip()
        if not v:
            raise ValueError("교과목 이름을 입력하세요.")
        out["name"] = v
    if "units" in b:
        u = to_int(b["units"]) or 1
        if u < 1 or u > 4:
            raise ValueError("2주 단위 수는 1~4 사이여야 합니다.")
        out["units"] = u
    if "consecutive" in b:
        out["consecutive"] = 1 if b["consecutive"] else 0
    if "sort" in b:
        out["sort"] = to_int(b["sort"]) or 0
    return out


@app.post("/api/terms/<int:tid>/courses")
@login_required
def course_create(tid):
    if not db().execute("SELECT 1 FROM terms WHERE id=?", (tid,)).fetchone():
        return err("학기를 찾을 수 없습니다.", 404)
    try:
        d = clean_course(body())
    except ValueError as e:
        return err(str(e))
    d.setdefault("sort", db().execute("SELECT COALESCE(MAX(sort),0)+1 FROM courses WHERE term_id=?", (tid,)).fetchone()[0])
    d["term_id"] = tid
    db().execute(f"INSERT INTO courses({','.join(d)}) VALUES({','.join('?' * len(d))})", list(d.values()))
    db().commit()
    return jsonify(ok=True, courses=courses_payload())


@app.put("/api/courses/<int:cid>")
@login_required
def course_update(cid):
    try:
        d = clean_course(body(), partial=True)
    except ValueError as e:
        return err(str(e))
    if not d:
        return err("바꿀 내용이 없습니다.")
    db().execute(f"UPDATE courses SET {','.join(k + '=?' for k in d)} WHERE id=?", [*d.values(), cid])
    db().commit()
    return jsonify(ok=True, courses=courses_payload())


@app.delete("/api/courses/<int:cid>")
@login_required
def course_delete(cid):
    db().execute("DELETE FROM institutions WHERE course_id=?", (cid,))
    db().execute("DELETE FROM courses WHERE id=?", (cid,))
    db().commit()
    return jsonify(ok=True, courses=courses_payload(), institutions=institutions_payload())


@app.post("/api/plan/import")
@login_required
def plan_import():
    """실습 계획 양식(기간·기관 시트)을 한 번에 등록. 파일에 있는 학기의 교과목·기관은 파일 내용으로 바뀐다."""
    b = body()
    rows = b.get("rows") or []
    periods = {(to_int(p.get("year")), to_int(p.get("grade")), to_int(p.get("sem"))): p.get("periods") or [] for p in (b.get("terms") or [])}
    keys = []
    for r in rows:
        k = (to_int(r.get("year")), to_int(r.get("grade")), to_int(r.get("sem")))
        if None in k or not str(r.get("course") or "").strip() or not str(r.get("inst") or "").strip():
            continue
        if k not in keys:
            keys.append(k)
    for k in periods:
        if None not in k and k not in keys:
            keys.append(k)
    if not keys:
        return err("파일에서 학기와 기관을 찾지 못했습니다. 양식의 열 이름을 확인하세요.")
    summary = []
    for (year, grade, sem) in keys:
        year3 = year - (grade - 3)
        kind = f"{grade}-{sem}"
        co = db().execute("SELECT id FROM cohorts WHERE year3=?", (year3,)).fetchone()
        cid = co[0] if co else create_cohort(db(), year3)
        t = db().execute("SELECT id FROM terms WHERE cohort_id=? AND kind=?", (cid, kind)).fetchone()
        if t:
            tid = t[0]
        else:
            n = db().execute("SELECT COALESCE(MAX(sort),0)+1 FROM terms WHERE cohort_id=?", (cid,)).fetchone()[0]
            tid = db().execute("INSERT INTO terms(label,periods,sort,cohort_id,kind) VALUES(?,?,?,?,?)",
                               (term_label(year3, kind), "[]", n, cid, kind)).lastrowid
        per = periods.get((year, grade, sem))
        if per:
            db().execute("UPDATE terms SET periods=? WHERE id=?",
                         (json.dumps([str(x or "").strip() for x in (list(per) + [""] * MAXP)[:MAXP]], ensure_ascii=False), tid))
        trows = [r for r in rows if (to_int(r.get("year")), to_int(r.get("grade")), to_int(r.get("sem"))) == (year, grade, sem)]
        if not trows:
            summary.append(f"{term_label(year3, kind)}: 기간만 반영")
            continue
        db().execute("DELETE FROM institutions WHERE course_id IN (SELECT id FROM courses WHERE term_id=?)", (tid,))
        db().execute("DELETE FROM courses WHERE term_id=?", (tid,))
        cmap, imap, ninst = {}, {}, 0
        for r in trows:
            cname = str(r["course"]).strip()
            if cname not in cmap:
                cmap[cname] = db().execute("INSERT INTO courses(term_id,name,units,consecutive,sort) VALUES(?,?,?,?,?)",
                                           (tid, cname, max(1, min(4, to_int(r.get("units")) or 1)), 1 if r.get("consec") else 0, len(cmap) + 1)).lastrowid
            iname = str(r["inst"]).strip()
            caps = [max(0, to_int(x) or 0) for x in (list(r.get("caps") or []) + [0] * MAXP)[:MAXP]]
            key = (cname, iname)
            if key not in imap:
                cur = db().execute("INSERT INTO institutions(course,course_id,name,short,kw,caps,grade,female,local,sort) VALUES('',?,?,?,?,?,?,?,?,?)",
                                   (cmap[cname], iname, str(r.get("short") or "").strip() or iname.replace("병원", ""), str(r.get("kw") or "").strip(),
                                    json.dumps(caps), 1 if r.get("grade_") else 0, 1 if r.get("female") else 0, 1 if r.get("local") else 0, len(imap) + 1))
                imap[key] = [cur.lastrowid, caps]
                ninst += 1
            else:
                old = imap[key][1]
                imap[key][1] = [a + c for a, c in zip(old, caps)]
                db().execute("UPDATE institutions SET caps=? WHERE id=?", (json.dumps(imap[key][1]), imap[key][0]))
            ward = str(r.get("ward") or "").strip()
            if ward and not db().execute("SELECT 1 FROM wards WHERE institution_id=? AND name=?", (imap[key][0], ward)).fetchone():
                db().execute("INSERT INTO wards(institution_id,name,sort) VALUES(?,?,?)", (imap[key][0], ward, 0))
        summary.append(f"{term_label(year3, kind)}: 교과목 {len(cmap)}개, 기관 {ninst}곳")
    db().commit()
    return jsonify(ok=True, summary=summary, cohorts=cohorts_payload(), terms=terms_payload(), courses=courses_payload(), institutions=institutions_payload())


def cohorts_payload():
    return [dict(r) for r in db().execute("SELECT * FROM cohorts ORDER BY year3")]


@app.post("/api/cohorts")
@login_required
def cohort_create():
    year3 = to_int(body().get("year3"))
    if not year3 or year3 < 2000 or year3 > 2100:
        return err("학년도를 확인하세요.")
    if db().execute("SELECT 1 FROM cohorts WHERE year3=?", (year3,)).fetchone():
        return err(f"{year3}년 3학년 기수가 이미 있습니다.")
    cid = create_cohort(db(), year3, str(body().get("name") or "").strip())
    db().commit()
    return jsonify(ok=True, id=cid, cohorts=cohorts_payload(), terms=terms_payload(), courses=courses_payload())


@app.put("/api/cohorts/<int:cid>")
@login_required
def cohort_update(cid):
    db().execute("UPDATE cohorts SET name=? WHERE id=?", (str(body().get("name") or "").strip(), cid))
    db().commit()
    return jsonify(ok=True, cohorts=cohorts_payload())


@app.delete("/api/cohorts/<int:cid>")
@login_required
def cohort_delete(cid):
    n = db().execute("SELECT COUNT(*) FROM students WHERE cohort_id=?", (cid,)).fetchone()[0]
    if n:
        return err(f"이 기수에 학생 {n}명이 있어 지울 수 없습니다. 학생을 먼저 지우세요.")
    db().execute("DELETE FROM terms WHERE cohort_id=?", (cid,))
    db().execute("DELETE FROM cohorts WHERE id=?", (cid,))
    db().commit()
    return jsonify(ok=True, cohorts=cohorts_payload(), terms=terms_payload())


# ---- 승인 절차: 임상실습주임교수가 승인 요청 → 임상산학학과장이 승인 또는 반려
REQUEST_ROLES = {"임상실습주임교수"}
APPROVE_ROLES = {"임상산학학과장"}
STATUS_NAMES = {"draft": "작성 중", "requested": "승인 요청", "approved": "승인", "returned": "반려"}


def term_log_payload():
    return [dict(r) for r in db().execute("SELECT * FROM term_log ORDER BY id DESC LIMIT 300")]


def set_status(tid, status, action, note=""):
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    db().execute("UPDATE terms SET status=?,status_note=?,status_by=?,status_at=? WHERE id=?",
                 (status, note, f"{g.user['name']}({g.user['role']})", now, tid))
    db().execute("INSERT INTO term_log(term_id,action,user_name,role,note,at) VALUES(?,?,?,?,?,?)",
                 (tid, action, g.user["name"], g.user["role"], note, now))


def reset_if_reviewed(tid, why):
    t = db().execute("SELECT status FROM terms WHERE id=?", (tid,)).fetchone()
    if t and t["status"] in ("requested", "approved"):
        set_status(tid, "draft", "초기화", why)


@app.post("/api/terms/<int:tid>/status")
@login_required
def term_status(tid):
    b = body()
    act_ = b.get("action")
    note = str(b.get("note") or "").strip()
    t = db().execute("SELECT t.*, (SELECT COUNT(*) FROM placements p WHERE p.term_id=t.id) AS count FROM terms t WHERE id=?", (tid,)).fetchone()
    if not t:
        return err("학기를 찾을 수 없습니다.", 404)
    role, st = g.user["role"], t["status"] or "draft"
    if act_ == "request":
        if role not in REQUEST_ROLES:
            return err("승인 요청은 임상실습주임교수만 할 수 있습니다.", 403)
        if st not in ("draft", "returned"):
            return err(f"지금 상태({STATUS_NAMES.get(st, st)})에서는 승인 요청을 할 수 없습니다.")
        if not t["count"]:
            return err("저장된 배치가 없습니다. 먼저 배치를 저장하세요.")
        set_status(tid, "requested", "승인 요청", note)
    elif act_ == "cancel":
        if role not in REQUEST_ROLES:
            return err("요청 취소는 임상실습주임교수만 할 수 있습니다.", 403)
        if st != "requested":
            return err("승인 요청 중인 학기가 아닙니다.")
        set_status(tid, "draft", "요청 취소", note)
    elif act_ == "approve":
        if role not in APPROVE_ROLES:
            return err("승인은 임상산학학과장만 할 수 있습니다.", 403)
        if st != "requested":
            return err("승인 요청된 학기만 승인할 수 있습니다.")
        set_status(tid, "approved", "승인", note)
    elif act_ == "return":
        if role not in APPROVE_ROLES:
            return err("반려는 임상산학학과장만 할 수 있습니다.", 403)
        if st not in ("requested", "approved"):
            return err("승인 요청되었거나 승인된 학기만 반려할 수 있습니다.")
        if not note:
            return err("반려 사유를 적어 주세요.")
        set_status(tid, "returned", "반려", note)
    else:
        return err("알 수 없는 요청입니다.")
    db().commit()
    return jsonify(ok=True, terms=terms_payload(), termLog=term_log_payload())


# ---- 배치 제외 기간 (교직실습 등)
def exclusions_payload():
    return [dict(r, periods=json.loads(r["periods"])) for r in db().execute("SELECT * FROM exclusions ORDER BY term_id,id")]


@app.post("/api/terms/<int:tid>/exclusions")
@login_required
def exclusion_add(tid):
    b = body()
    if not db().execute("SELECT 1 FROM terms WHERE id=?", (tid,)).fetchone():
        return err("학기를 찾을 수 없습니다.", 404)
    ids = [to_int(x) for x in (b.get("student_ids") or []) if to_int(x)]
    periods = sorted({p for p in (to_int(x) for x in (b.get("periods") or [])) if p is not None and 0 <= p < MAXP})
    if not ids:
        return err("학생을 고르세요.")
    if not periods:
        return err("제외할 기간을 하나 이상 고르세요.")
    reason = str(b.get("reason") or "").strip()
    for sid in ids:
        db().execute("INSERT INTO exclusions(term_id,student_id,periods,reason) VALUES(?,?,?,?) "
                     "ON CONFLICT(term_id,student_id) DO UPDATE SET periods=excluded.periods,reason=excluded.reason",
                     (tid, sid, json.dumps(periods), reason))
    db().commit()
    return jsonify(ok=True, exclusions=exclusions_payload())


# ---- 지정 배치: 이 학생은 이 기간에 이 기관 (예: 교직실습 학생은 1월 아주대학교병원)
def pins_payload():
    return [dict(r) for r in db().execute("SELECT * FROM pins ORDER BY term_id,id")]


@app.post("/api/terms/<int:tid>/pins")
@login_required
def pin_add(tid):
    b = body()
    ids = [to_int(x) for x in (b.get("student_ids") or []) if to_int(x)]
    iid, period = to_int(b.get("institution_id")), to_int(b.get("period"))
    if not ids:
        return err("학생을 고르세요.")
    ok = db().execute("SELECT 1 FROM institutions i JOIN courses c ON c.id=i.course_id WHERE i.id=? AND c.term_id=?", (iid, tid)).fetchone()
    if not ok:
        return err("이 학기의 기관을 고르세요.")
    if period is None or not 0 <= period < MAXP:
        return err("기간을 고르세요.")
    reason = str(b.get("reason") or "").strip()
    for sid in ids:
        db().execute("INSERT INTO pins(term_id,student_id,institution_id,period,reason) VALUES(?,?,?,?,?) "
                     "ON CONFLICT(term_id,student_id,period) DO UPDATE SET institution_id=excluded.institution_id,reason=excluded.reason",
                     (tid, sid, iid, period, reason))
    db().commit()
    return jsonify(ok=True, pins=pins_payload())


@app.delete("/api/pins/<int:pid>")
@login_required
def pin_delete(pid):
    db().execute("DELETE FROM pins WHERE id=?", (pid,))
    db().commit()
    return jsonify(ok=True, pins=pins_payload())


@app.delete("/api/exclusions/<int:eid>")
@login_required
def exclusion_delete(eid):
    db().execute("DELETE FROM exclusions WHERE id=?", (eid,))
    db().commit()
    return jsonify(ok=True, exclusions=exclusions_payload())


def terms_payload():
    rows = db().execute(
        "SELECT t.*, (SELECT COUNT(*) FROM placements p WHERE p.term_id=t.id) AS count FROM terms t ORDER BY sort,id").fetchall()
    return [dict(r, periods=json.loads(r["periods"])) for r in rows]


def weights():
    r = db().execute("SELECT value FROM settings WHERE key='weights'").fetchone()
    w = dict(DEFAULT_WEIGHTS)
    if r:
        w.update(json.loads(r["value"]))
    return w


@app.get("/api/bootstrap")
@login_required
def bootstrap():
    can = g.user["role"] in MANAGER_ROLES
    data = {
        "me": dict(g.user),
        "roles": ROLES,
        "canManage": can,
        "institutions": institutions_payload(),
        "cohorts": cohorts_payload(),
        "courses": courses_payload(),
        "exclusions": exclusions_payload(),
        "pins": pins_payload(),
        "termLog": term_log_payload(),
        "students": [dict(r) for r in db().execute("SELECT * FROM students ORDER BY student_no")],
        "terms": terms_payload(),
        "placements": [dict(r) for r in db().execute(
            "SELECT term_id,student_id,seq,period,institution,course,ward FROM placements ORDER BY term_id,student_id,seq")],
        "weights": weights(),
        "persistent": PERSISTENT,
    }
    if can:
        data["users"] = [dict(r) for r in db().execute("SELECT id,login_id,name,role,created_at FROM users ORDER BY id")]
    return jsonify(data)


# ---- institutions & wards
INST_FIELDS = ("course_id", "name", "short", "kw", "caps", "grade", "female", "local", "sort")


def clean_inst(b, partial=False):
    out = {}
    for k in INST_FIELDS:
        if k not in b:
            continue
        v = b[k]
        if k == "course_id":
            v = to_int(v)
            if not v or not db().execute("SELECT 1 FROM courses WHERE id=?", (v,)).fetchone():
                raise ValueError("교과목을 찾을 수 없습니다.")
        elif k in ("name", "short", "kw"):
            v = str(v or "").strip()
            if k == "name" and not v:
                raise ValueError("기관명을 입력하세요.")
        elif k == "caps":
            v = [max(0, to_int(x) or 0) for x in (list(v or []) + [0] * MAXP)[:MAXP]]
            v = json.dumps(v)
        elif k in ("grade", "female", "local"):
            v = 1 if v else 0
        elif k == "sort":
            v = to_int(v) or 0
        out[k] = v
    if not partial and ("course_id" not in out or "name" not in out):
        raise ValueError("교과목과 기관명이 필요합니다.")
    return out


@app.post("/api/institutions")
@login_required
def inst_create():
    b = body()
    try:
        d = clean_inst(b)
    except ValueError as e:
        return err(str(e))
    d.setdefault("short", d["name"].replace("병원", ""))
    d["course"] = ""
    d.setdefault("caps", json.dumps([0, 0, 0, 0]))
    if "sort" not in d:
        d["sort"] = (db().execute("SELECT COALESCE(MAX(sort),0)+1 FROM institutions").fetchone()[0])
    cols = ",".join(d)
    cur = db().execute(f"INSERT INTO institutions({cols}) VALUES({','.join('?' * len(d))})", list(d.values()))
    for j, w in enumerate(b.get("wards") or []):
        if str(w).strip():
            db().execute("INSERT INTO wards(institution_id,name,sort) VALUES(?,?,?)", (cur.lastrowid, str(w).strip(), j))
    db().commit()
    return jsonify(ok=True, id=cur.lastrowid, institutions=institutions_payload())


@app.put("/api/institutions/<int:iid>")
@login_required
def inst_update(iid):
    try:
        d = clean_inst(body(), partial=True)
    except ValueError as e:
        return err(str(e))
    if not d:
        return err("바꿀 내용이 없습니다.")
    db().execute(f"UPDATE institutions SET {','.join(k + '=?' for k in d)} WHERE id=?", [*d.values(), iid])
    db().commit()
    return jsonify(ok=True, institutions=institutions_payload())


@app.delete("/api/institutions/<int:iid>")
@login_required
def inst_delete(iid):
    db().execute("DELETE FROM institutions WHERE id=?", (iid,))
    db().commit()
    return jsonify(ok=True, institutions=institutions_payload())


@app.post("/api/institutions/<int:iid>/wards")
@login_required
def ward_create(iid):
    name = str(body().get("name") or "").strip()
    if not name:
        return err("병동 이름을 입력하세요.")
    if not db().execute("SELECT 1 FROM institutions WHERE id=?", (iid,)).fetchone():
        return err("기관을 찾을 수 없습니다.", 404)
    sort = db().execute("SELECT COALESCE(MAX(sort),0)+1 FROM wards WHERE institution_id=?", (iid,)).fetchone()[0]
    db().execute("INSERT INTO wards(institution_id,name,sort) VALUES(?,?,?)", (iid, name, sort))
    db().commit()
    return jsonify(ok=True, institutions=institutions_payload())


@app.put("/api/wards/<int:wid>")
@login_required
def ward_update(wid):
    name = str(body().get("name") or "").strip()
    if not name:
        return err("병동 이름을 입력하세요.")
    db().execute("UPDATE wards SET name=? WHERE id=?", (name, wid))
    db().commit()
    return jsonify(ok=True, institutions=institutions_payload())


@app.delete("/api/wards/<int:wid>")
@login_required
def ward_delete(wid):
    db().execute("DELETE FROM wards WHERE id=?", (wid,))
    db().commit()
    return jsonify(ok=True, institutions=institutions_payload())


# ---- students
def clean_student(b, partial=False):
    out = {}
    if "student_no" in b or not partial:
        v = str(b.get("student_no") or "").strip()
        if not v:
            raise ValueError("학번을 입력하세요.")
        out["student_no"] = v
    if "name" in b or not partial:
        v = str(b.get("name") or "").strip()
        if not v:
            raise ValueError("이름을 입력하세요.")
        out["name"] = v
    if "sex" in b:
        out["sex"] = "남" if str(b["sex"]).strip().startswith(("남", "M", "m")) else "여"
    if "gpa" in b:
        out["gpa"] = to_float(b["gpa"])
    if "age" in b:
        out["age"] = to_int(b["age"])
    for k in ("addr", "note"):
        if k in b:
            out[k] = str(b[k] or "").strip()
    if "cohort_id" in b:
        cid = to_int(b["cohort_id"])
        if not cid or not db().execute("SELECT 1 FROM cohorts WHERE id=?", (cid,)).fetchone():
            raise ValueError("학년(기수)을 찾을 수 없습니다.")
        out["cohort_id"] = cid
    return out


def students_payload():
    return [dict(r) for r in db().execute("SELECT * FROM students ORDER BY student_no")]


@app.post("/api/students")
@login_required
def student_create():
    try:
        d = clean_student(body())
    except ValueError as e:
        return err(str(e))
    if "cohort_id" not in d:
        return err("학년(기수)을 고르세요.")
    ex = db().execute("SELECT c.year3 FROM students s LEFT JOIN cohorts c ON c.id=s.cohort_id WHERE s.student_no=?", (d["student_no"],)).fetchone()
    if ex:
        return err(f"학번 {d['student_no']} 학생이 이미 있습니다" + (f" ({ex[0]}년 3학년 명단)." if ex[0] else "."))
    db().execute(f"INSERT INTO students({','.join(d)}) VALUES({','.join('?' * len(d))})", list(d.values()))
    db().commit()
    return jsonify(ok=True, students=students_payload())


@app.put("/api/students/<int:sid>")
@login_required
def student_update(sid):
    try:
        d = clean_student(body(), partial=True)
    except ValueError as e:
        return err(str(e))
    if not d:
        return err("바꿀 내용이 없습니다.")
    if "student_no" in d and db().execute("SELECT 1 FROM students WHERE student_no=? AND id<>?", (d["student_no"], sid)).fetchone():
        return err("같은 학번의 학생이 이미 있습니다.")
    db().execute(f"UPDATE students SET {','.join(k + '=?' for k in d)},updated_at=CURRENT_TIMESTAMP WHERE id=?", [*d.values(), sid])
    db().commit()
    return jsonify(ok=True, student=dict(db().execute("SELECT * FROM students WHERE id=?", (sid,)).fetchone()))


@app.delete("/api/students/<int:sid>")
@login_required
def student_delete(sid):
    db().execute("DELETE FROM students WHERE id=?", (sid,))
    db().commit()
    return jsonify(ok=True)


@app.post("/api/students/import")
@login_required
def student_import():
    rows = body().get("students") or []
    cid = to_int(body().get("cohort_id"))
    if not cid or not db().execute("SELECT 1 FROM cohorts WHERE id=?", (cid,)).fetchone():
        return err("학년(기수)을 고르세요.")
    added = updated = 0
    errors, other = [], []
    for i, b in enumerate(rows):
        try:
            d = clean_student({k: v for k, v in b.items() if k != "cohort_id"})
        except ValueError as e:
            errors.append(f"{i + 1}행: {e}")
            continue
        d["cohort_id"] = cid
        ex = db().execute("SELECT id,cohort_id FROM students WHERE student_no=?", (d["student_no"],)).fetchone()
        if ex and ex["cohort_id"] not in (None, cid):
            other.append(f"{d['name']}({d['student_no']})")
            continue
        if ex:
            d.pop("student_no")
            if "note" in d and not d["note"]:
                d.pop("note")  # 엑셀에 참고가 비어 있으면 저장된 참고를 지우지 않음
            db().execute(f"UPDATE students SET {','.join(k + '=?' for k in d)},updated_at=CURRENT_TIMESTAMP WHERE id=?",
                         [*d.values(), ex["id"]])
            updated += 1
        else:
            db().execute(f"INSERT INTO students({','.join(d)}) VALUES({','.join('?' * len(d))})", list(d.values()))
            added += 1
    db().commit()
    return jsonify(ok=True, added=added, updated=updated, errors=errors, other=other, students=students_payload())


# ---- terms & placements
@app.post("/api/terms")
@login_required
def term_create():
    b = body()
    label = str(b.get("label") or "").strip()
    if not label:
        return err("학기 이름을 입력하세요.")
    if db().execute("SELECT 1 FROM terms WHERE label=?", (label,)).fetchone():
        return err("같은 이름의 학기가 이미 있습니다.")
    periods = [str(x or "").strip() for x in (list(b.get("periods") or []) + [""] * MAXP)[:MAXP]]
    cid = to_int(b.get("cohort_id"))
    if not cid or not db().execute("SELECT 1 FROM cohorts WHERE id=?", (cid,)).fetchone():
        return err("학년(기수)을 고르세요.")
    sort = to_int(b.get("sort"))
    if sort is None:
        sort = db().execute("SELECT COALESCE(MAX(sort),0)+1 FROM terms WHERE cohort_id=?", (cid,)).fetchone()[0]
    cur = db().execute("INSERT INTO terms(label,periods,sort,cohort_id,kind) VALUES(?,?,?,?,'etc')",
                       (label, json.dumps(periods, ensure_ascii=False), sort, cid))
    db().commit()
    return jsonify(ok=True, id=cur.lastrowid, terms=terms_payload())


@app.put("/api/terms/<int:tid>")
@login_required
def term_update(tid):
    b = body()
    sets, vals = [], []
    if "label" in b:
        label = str(b["label"] or "").strip()
        if not label:
            return err("학기 이름을 입력하세요.")
        if db().execute("SELECT 1 FROM terms WHERE label=? AND id<>?", (label, tid)).fetchone():
            return err("같은 이름의 학기가 이미 있습니다.")
        sets.append("label=?"); vals.append(label)
    if "periods" in b:
        sets.append("periods=?")
        vals.append(json.dumps([str(x or "").strip() for x in (list(b["periods"] or []) + [""] * MAXP)[:MAXP]], ensure_ascii=False))
    if "sort" in b:
        sets.append("sort=?"); vals.append(to_int(b["sort"]) or 0)
    if not sets:
        return err("바꿀 내용이 없습니다.")
    db().execute(f"UPDATE terms SET {','.join(sets)} WHERE id=?", [*vals, tid])
    db().commit()
    return jsonify(ok=True, terms=terms_payload())


@app.delete("/api/terms/<int:tid>")
@login_required
def term_delete(tid):
    db().execute("DELETE FROM terms WHERE id=?", (tid,))
    db().commit()
    return jsonify(ok=True, terms=terms_payload())


@app.put("/api/terms/<int:tid>/placements")
@login_required
def placements_put(tid):
    """replace_all=true: 이 학기 배치를 통째로 바꿈. 아니면 placements에 나온 학생의 배치만 바꿈."""
    b = body()
    if not db().execute("SELECT 1 FROM terms WHERE id=?", (tid,)).fetchone():
        return err("학기를 찾을 수 없습니다.", 404)
    rows = b.get("placements") or []
    valid_ids = {r[0] for r in db().execute("SELECT id FROM students")}
    clean = []
    for p in rows:
        sid = to_int(p.get("student_id"))
        inst = str(p.get("institution") or "").strip()
        if sid not in valid_ids or not inst:
            continue
        clean.append((tid, sid, to_int(p.get("seq")) or 1, str(p.get("period") or "").strip(), inst,
                      str(p.get("course") or "").strip(), str(p.get("ward") or "").strip()))
    if b.get("replace_all"):
        db().execute("DELETE FROM placements WHERE term_id=?", (tid,))
        reset_if_reviewed(tid, "배치가 새로 저장됨")
    else:
        reset_if_reviewed(tid, "배치 이력이 바뀜")
        for sid in {c[1] for c in clean}:
            db().execute("DELETE FROM placements WHERE term_id=? AND student_id=?", (tid, sid))
    db().executemany("INSERT INTO placements(term_id,student_id,seq,period,institution,course,ward) VALUES(?,?,?,?,?,?,?)", clean)
    db().commit()
    return jsonify(ok=True, saved=len(clean), terms=terms_payload(), termLog=term_log_payload(), placements=[dict(r) for r in db().execute(
        "SELECT term_id,student_id,seq,period,institution,course,ward FROM placements ORDER BY term_id,student_id,seq")])


@app.delete("/api/terms/<int:tid>/placements")
@login_required
def placements_clear(tid):
    db().execute("DELETE FROM placements WHERE term_id=?", (tid,))
    reset_if_reviewed(tid, "배치를 비움")
    db().commit()
    return jsonify(ok=True, terms=terms_payload())


# ---- settings
@app.put("/api/settings")
@login_required
def settings_put():
    w = weights()
    for k, v in (body().get("weights") or {}).items():
        if k in DEFAULT_WEIGHTS and to_float(v) is not None:
            w[k] = to_float(v)
    db().execute("INSERT OR REPLACE INTO settings(key,value) VALUES('weights',?)", (json.dumps(w),))
    db().commit()
    return jsonify(ok=True, weights=w)


# ---- accounts
def users_payload():
    return [dict(r) for r in db().execute("SELECT id,login_id,name,role,created_at FROM users ORDER BY id")]


def check_pw(pw):
    if len(pw or "") < 8:
        raise ValueError("비밀번호는 8자 이상이어야 합니다.")


@app.post("/api/users")
@manager_required
def user_create():
    b = body()
    login_id = str(b.get("login_id") or "").strip()
    name = str(b.get("name") or "").strip()
    role = b.get("role")
    if not login_id or not name:
        return err("아이디와 이름을 입력하세요.")
    if role not in ROLES:
        return err("직위를 선택하세요.")
    try:
        check_pw(b.get("password"))
    except ValueError as e:
        return err(str(e))
    if db().execute("SELECT 1 FROM users WHERE login_id=?", (login_id,)).fetchone():
        return err("이미 있는 아이디입니다.")
    db().execute("INSERT INTO users(login_id,name,role,pw_hash,must_change) VALUES(?,?,?,?,1)",
                 (login_id, name, role, generate_password_hash(b["password"])))
    db().commit()
    return jsonify(ok=True, users=users_payload())


def _managers_left(excluding=None, new_role=None):
    rows = db().execute("SELECT id,role FROM users").fetchall()
    n = 0
    for r in rows:
        role = new_role if r["id"] == excluding and new_role is not None else r["role"]
        if r["id"] == excluding and new_role is None:
            continue
        if role in MANAGER_ROLES:
            n += 1
    return n


@app.put("/api/users/<int:uid>")
@manager_required
def user_update(uid):
    b = body()
    sets, vals = [], []
    if "name" in b and str(b["name"]).strip():
        sets.append("name=?"); vals.append(str(b["name"]).strip())
    if "role" in b:
        if b["role"] not in ROLES:
            return err("직위를 선택하세요.")
        if _managers_left(excluding=uid, new_role=b["role"]) == 0:
            return err("계정을 관리할 수 있는 직위(학부장·임상산학학과장·임상실습주임교수)가 최소 1명은 있어야 합니다.")
        sets.append("role=?"); vals.append(b["role"])
    if b.get("password"):
        try:
            check_pw(b["password"])
        except ValueError as e:
            return err(str(e))
        sets.append("pw_hash=?"); vals.append(generate_password_hash(b["password"]))
        sets.append("init_pw=0")
        if uid != g.user["id"]:
            sets.append("must_change=1")
    if not sets:
        return err("바꿀 내용이 없습니다.")
    db().execute(f"UPDATE users SET {','.join(sets)} WHERE id=?", [*vals, uid])
    db().commit()
    return jsonify(ok=True, users=users_payload())


@app.delete("/api/users/<int:uid>")
@manager_required
def user_delete(uid):
    if uid == g.user["id"]:
        return err("지금 로그인한 본인 계정은 지울 수 없습니다.")
    if _managers_left(excluding=uid) == 0:
        return err("계정을 관리할 수 있는 직위가 최소 1명은 있어야 합니다.")
    db().execute("DELETE FROM users WHERE id=?", (uid,))
    db().commit()
    return jsonify(ok=True, users=users_payload())


@app.put("/api/me/password")
@login_required
def my_password():
    b = body()
    u = db().execute("SELECT pw_hash FROM users WHERE id=?", (g.user["id"],)).fetchone()
    if not check_password_hash(u["pw_hash"], b.get("current") or ""):
        return err("지금 비밀번호가 맞지 않습니다.")
    try:
        check_pw(b.get("new"))
    except ValueError as e:
        return err(str(e))
    if b.get("new") == b.get("current"):
        return err("지금과 다른 비밀번호를 쓰세요.")
    db().execute("UPDATE users SET pw_hash=?,must_change=0,init_pw=0 WHERE id=?", (generate_password_hash(b["new"]), g.user["id"]))
    db().commit()
    return jsonify(ok=True)


@app.get("/api/backup")
@login_required
def backup():
    data = {"exported_at": datetime.datetime.now().isoformat(timespec="seconds")}
    for t in ("institutions", "wards", "students", "terms", "placements", "settings"):
        data[t] = [dict(r) for r in db().execute(f"SELECT * FROM {t}")]
    name = f"clinic-backup-{datetime.date.today().isoformat()}.json"
    return Response(json.dumps(data, ensure_ascii=False, indent=1), mimetype="application/json",
                    headers={"Content-Disposition": f"attachment; filename={name}"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=bool(os.environ.get("FLASK_DEBUG")))
