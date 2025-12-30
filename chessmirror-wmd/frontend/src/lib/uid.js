import { nanoid } from "nanoid";

export function getUid() {
  const key = "cm_uid";
  let uid = localStorage.getItem(key);
  if (!uid) {
    uid = `u_${nanoid(10)}`;
    localStorage.setItem(key, uid);
  }
  return uid;
}

export function getSessionId() {
  const key = "cm_session";
  let sid = sessionStorage.getItem(key);
  if (!sid) {
    sid = `s_${nanoid(10)}`;
    sessionStorage.setItem(key, sid);
  }
  return sid;
}
