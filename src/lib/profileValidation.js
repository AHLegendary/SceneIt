// Limits match the check constraints on public.profiles.
export const BIO_MAX = 300
export const PRONOUNS_MAX = 30

// Postgres char_length counts characters, not UTF-16 units, so emoji count once.
export function charCount(text) {
  return [...text].length
}

export function validateBio(bio) {
  if (charCount(bio.trim()) > BIO_MAX) return `Keep your bio to ${BIO_MAX} characters or fewer.`
  return ''
}

export function validatePronouns(pronouns) {
  if (charCount(pronouns.trim()) > PRONOUNS_MAX) {
    return `Keep pronouns to ${PRONOUNS_MAX} characters or fewer.`
  }
  return ''
}

export function validateProfile({ bio, pronouns }) {
  const errors = {}
  const bioError = validateBio(bio)
  const pronounsError = validatePronouns(pronouns)
  if (bioError) errors.bio = bioError
  if (pronounsError) errors.pronouns = pronounsError
  return errors
}

// Form values -> the columns to write. Blank text is stored as null.
export function toProfileUpdate({ bio, pronouns, isPublic }) {
  return {
    bio: bio.trim() || null,
    pronouns: pronouns.trim() || null,
    is_public: isPublic,
  }
}

// Escapes LIKE wildcards so a username is matched literally by ilike.
// "_" is a wildcard in LIKE patterns and is allowed in usernames.
export function escapeLike(text) {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`)
}
