/**
 * Build the URL for a partner's avatar image
 * Uses the Next.js API proxy to handle CORS and 303 redirects from Odoo;
 * the session cookie goes with the request.
 *
 * @param partnerId - The ID of the partner record
 * @returns The API proxy URL of the avatar image
 */
export function buildPartnerAvatarUrl(partnerId: number): string {
  return `/api/avatar/${partnerId}`;
}
