export function isGoogleMailAddress(email: string): boolean {
    return /@(?:gmail|googlemail)\.com$/i.test(email.trim());
}
