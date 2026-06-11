/**
 * Item-level access roles for registry resources.
 *
 * Ported from legacy `ProvenaInterfaces/RegistryModels.py` (auth models section).
 */

export const METADATA_READ_ROLE = "metadata-read";
export const METADATA_WRITE_ROLE = "metadata-write";
export const DATASET_READ_ROLE = "dataset-data-read";
export const DATASET_WRITE_ROLE = "dataset-data-write";
export const ADMIN_ROLE = "admin";

export type Role = string;
export type Roles = Role[];

export const metadataReadWrite: Roles = [METADATA_READ_ROLE, METADATA_WRITE_ROLE];
export const datasetDataReadWrite: Roles = [DATASET_READ_ROLE, DATASET_WRITE_ROLE];

/** Roles available on all entity types. */
export const ENTITY_BASE_ROLE_LIST: Roles = [...metadataReadWrite, ADMIN_ROLE];
/** Roles available on datasets (adds data read/write). */
export const DATASET_ROLE_LIST: Roles = [...ENTITY_BASE_ROLE_LIST, ...datasetDataReadWrite];

export const ALL_ROLES: ReadonlySet<string> = new Set([
  ...ENTITY_BASE_ROLE_LIST,
  ...DATASET_ROLE_LIST,
]);

export interface DescribedRole {
  role_display_name: string;
  role_name: string;
  description: string;
  also_grants: string[];
}

/** Role metadata, including the transitive `also_grants` expansion sets. */
export const ROLE_METADATA_MAP: Record<string, DescribedRole> = {
  [METADATA_READ_ROLE]: {
    role_display_name: "Metadata Read",
    role_name: METADATA_READ_ROLE,
    also_grants: [],
    description: "Enables visibility of a resource and it's metadata.",
  },
  [METADATA_WRITE_ROLE]: {
    role_display_name: "Metadata Write",
    role_name: METADATA_WRITE_ROLE,
    also_grants: [METADATA_READ_ROLE],
    description: "Enables the modification of a resource's metadata.",
  },
  [DATASET_READ_ROLE]: {
    role_display_name: "Dataset Data Read",
    role_name: DATASET_READ_ROLE,
    also_grants: [METADATA_READ_ROLE],
    description: "Enables the downloading of the contents of a dataset.",
  },
  [DATASET_WRITE_ROLE]: {
    role_display_name: "Dataset Data Write",
    role_name: DATASET_WRITE_ROLE,
    also_grants: [METADATA_READ_ROLE, METADATA_WRITE_ROLE, DATASET_READ_ROLE],
    description: "Enables the uploading, modification and deletion of dataset files.",
  },
  [ADMIN_ROLE]: {
    role_display_name: "Admin",
    role_name: ADMIN_ROLE,
    also_grants: [
      METADATA_READ_ROLE,
      METADATA_WRITE_ROLE,
      DATASET_READ_ROLE,
      DATASET_WRITE_ROLE,
    ],
    description:
      "Enables all actions on a resource and it's contents, including changes to access settings.",
  },
};

/**
 * Expands a set of directly-granted roles into the full set of effective roles
 * using the `also_grants` relationships.
 */
export const expandRoles = (granted: Iterable<string>): Set<string> => {
  const result = new Set<string>();
  const queue = [...granted];
  while (queue.length > 0) {
    const role = queue.pop()!;
    if (result.has(role)) continue;
    result.add(role);
    const meta = ROLE_METADATA_MAP[role];
    if (meta) queue.push(...meta.also_grants);
  }
  return result;
};
