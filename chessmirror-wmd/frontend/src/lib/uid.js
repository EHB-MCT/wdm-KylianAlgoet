import { nanoid } from "nanoid";

const UID_KEY = "cm_uid_current";
const SID_KEY = "cm_session";

function makeUid() {
  return `u_${nanoid(10)}`;
}
function makeSid() {
  return `s_${nanoid(10)}`;
}

// UID for current "person/game"
export function getUid() {
  let uid = sessionStorage.getItem(UID_KEY);
  if (!uid) {
    uid = makeUid();
    sessionStorage.setItem(UID_KEY, uid);
  }
  return uid;
}

// ✅ OPTIE A: call this on New Game
export function newUid() {
  const uid = makeUid();
  sessionStorage.setItem(UID_KEY, uid);
  return uid;
}

export function getSessionId() {
  let sid = sessionStorage.getItem(SID_KEY);
  if (!sid) {
    sid = makeSid();
    sessionStorage.setItem(SID_KEY, sid);
  }
  return sid;
}

// (optional but recommended): new session per game
export function newSessionId() {
  const sid = makeSid();
  sessionStorage.setItem(SID_KEY, sid);
  return sid;
}
