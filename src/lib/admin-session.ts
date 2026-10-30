// Ephemeral same-tab Admin credential cache. Never persisted to browser storage.
let adminPasswordInMemory = "";

export function setAdminPasswordInMemory(password: string) {
  adminPasswordInMemory = password;
}

export function getAdminPasswordInMemory() {
  return adminPasswordInMemory;
}

export function clearAdminPasswordInMemory() {
  adminPasswordInMemory = "";
}
