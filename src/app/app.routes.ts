import { Routes } from '@angular/router';
import { authCanMatch } from '@core/auth/auth.guard';

export const routes: Routes = [
  {
    path: 'auth',
    loadChildren: () =>
      import('@features/auth/auth.routes').then((m) => m.default),
  },
  {
    path: '',
    canMatch: [authCanMatch],
    loadChildren: () =>
      import('@features/shell/shell.routes').then((m) => m.default),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
