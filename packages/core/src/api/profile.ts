/** Contract types for /v1/profile. */
import type { LykiaProfile } from "../profile.js";

export interface ProfileResponse {
  readonly owner: string;
  readonly profile: LykiaProfile;
  /** What the profile changes downstream, in words (Fence shape, routing ceiling, display). */
  readonly effects: readonly string[];
}
