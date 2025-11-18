export type UserRole =
  | 'Super Admin'
  | 'Admin'
  | 'Operator'
  | 'Viewer'
  | 'Maintenance'
  | 'Finance';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  image?: string; // User profile image/avatar URL (legacy/alias)
  logo?: string; // User profile image/avatar path (backend field: logos/user/filename)
  accessibleDevelopers: string[];
  accessibleProjects: string[];
  accessibleCameras: string[];
  accessibleServices?: string[];
  createdAt?: string;
  lastLoginAt?: string;
  phone?: string;
  status?: string;
  [key: string]: unknown;
}

