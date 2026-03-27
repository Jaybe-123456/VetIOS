export interface PasswordValidationResult {
    valid: boolean;
    issues: string[];
}

const MIN_PASSWORD_LENGTH = 10;
const COMMON_PASSWORD_FRAGMENTS = ['password', '123456', 'qwerty', 'letmein', 'welcome'];

export function validatePasswordPolicy(email: string, password: string): PasswordValidationResult {
    const issues: string[] = [];
    const normalizedPassword = password.trim();

    if (normalizedPassword.length < MIN_PASSWORD_LENGTH) {
        issues.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (!/[a-z]/.test(normalizedPassword)) {
        issues.push('Add a lowercase letter.');
    }
    if (!/[A-Z]/.test(normalizedPassword)) {
        issues.push('Add an uppercase letter.');
    }
    if (!/\d/.test(normalizedPassword)) {
        issues.push('Add a number.');
    }
    if (!/[^A-Za-z0-9]/.test(normalizedPassword)) {
        issues.push('Add a symbol.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const localPart = normalizedEmail.split('@')[0] ?? '';
    if (localPart.length >= 3 && normalizedPassword.toLowerCase().includes(localPart)) {
        issues.push('Do not include your email name in the password.');
    }

    if (COMMON_PASSWORD_FRAGMENTS.some((fragment) => normalizedPassword.toLowerCase().includes(fragment))) {
        issues.push('Avoid common password patterns.');
    }

    return {
        valid: issues.length === 0,
        issues,
    };
}
