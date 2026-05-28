// lib/owners.js
// Owner registry — maps initiative owner names (as they appear in the sheet)
// to email addresses and display names

export const OWNERS = {
  Julie: {
    name: 'Julie',
    fullName: 'Julie Matrat',
    email: 'julie.matrat@leafgroup.com',
  },
  Sara: {
    name: 'Sara',
    fullName: 'Sara Jackson',
    email: 'sara.jackson@leafgroup.com',
  },
  Holly: {
    name: 'Holly',
    fullName: 'Holly Cann',
    email: 'holly.cann@leafgroup.com',
  },
  John: {
    name: 'John',
    fullName: 'John Alderman',
    email: 'john.alderman@leafgroup.com',
  },
  Rie: {
    name: 'Rie',
    fullName: 'Rie Grant',
    email: 'rie.grant@leafgroup.com',
  },
};

// Digest recipients — who gets the Monday morning summary
export const DIGEST_RECIPIENTS = [
  'john.alderman@leafgroup.com', // test mode — swap in julie + sara when ready
];

// TEST MODE: when true, all emails go only to John
export const TEST_MODE = true;

export function getTestEmail() {
  return 'john.alderman@leafgroup.com';
}

// Normalize owner name from sheet to our registry key
export function normalizeOwner(rawOwner) {
  if (!rawOwner) return null;
  const name = rawOwner.trim();
  if (name === 'Everyone' || name === '') return null;
  if (OWNERS[name]) return name;
  for (const key of Object.keys(OWNERS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return key;
  }
  return null;
}
