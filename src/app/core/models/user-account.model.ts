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

