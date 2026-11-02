const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Matches the profiles.username check in the database.
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/

export const MIN_PASSWORD_LENGTH = 8

export function validateEmail(email) {
  const value = email.trim()
  if (!value) return 'Enter your email.'
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid email, like name@example.com.'
  return ''
}

export function validateLoginPassword(password) {
  if (!password) return 'Enter your password.'
  return ''
}

export function validateUsername(username) {
  const value = username.trim()
  if (!value) return 'Choose a username.'
  if (!USERNAME_PATTERN.test(value)) {
    return 'Use 3 to 20 letters, numbers, or underscores.'
  }
  return ''
}

export function validateNewPassword(password) {
  if (!password) return 'Create a password.'
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  return ''
}

// Login accepts an email or a username; only emails contain "@".
export function isEmail(identifier) {
  return identifier.includes('@')
}

export function validateIdentifier(identifier) {
  const value = identifier.trim()
  if (!value) return 'Enter your email or username.'
  if (isEmail(value)) return validateEmail(value)
  if (!USERNAME_PATTERN.test(value)) return 'Enter a valid email or username.'
  return ''
}

export function validateLogin({ identifier, password }) {
  const errors = {}
  const identifierError = validateIdentifier(identifier)
  const passwordError = validateLoginPassword(password)
  if (identifierError) errors.identifier = identifierError
  if (passwordError) errors.password = passwordError
  return errors
}

export function validateSignUp({ username, email, password }) {
  const errors = {}
  const usernameError = validateUsername(username)
  const emailError = validateEmail(email)
  const passwordError = validateNewPassword(password)
  if (usernameError) errors.username = usernameError
  if (emailError) errors.email = emailError
  if (passwordError) errors.password = passwordError
  return errors
}
