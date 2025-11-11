import { AuthenticatedUser } from '@core/models/user-account.model';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: AuthenticatedUser;
}

export interface AuthState {
  status: 'anonymous' | 'authenticating' | 'authenticated';
  user: AuthenticatedUser | null;
  token: string | null;
}

