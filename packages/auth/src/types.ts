/** Authenticated user extracted from a validated Keycloak JWT. */
export interface AuthenticatedUser {
  /** Keycloak `preferred_username`. */
  username: string;
  email: string | null;
  /** Realm roles (`realm_access.roles`). */
  roles: string[];
  /** Raw access token (forwarded where needed). */
  accessToken: string;
}

/** Legacy `User` response shape for the check-access endpoints. */
export interface UserResponse {
  username: string;
  email: string | null;
  roles: string[];
  access_token: string;
}

export const toUserResponse = (user: AuthenticatedUser): UserResponse => ({
  username: user.username,
  email: user.email,
  roles: user.roles,
  access_token: user.accessToken,
});

/** Hono environment carrying the authenticated user. */
export type AuthEnv = {
  Variables: {
    user: AuthenticatedUser;
    /** Roles which granted access to the matched protected route. */
    accessRoles: string[];
  };
};
