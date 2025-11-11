import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

interface UserSummary {
  name: string;
  email: string;
  role: string;
  lastLogin: string;
  status: 'Active' | 'Invited' | 'Suspended';
}

@Component({
  selector: 'app-users-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './users-overview.component.html',
})
export class UsersOverviewComponent {
  readonly userSummaries: UserSummary[] = [
    {
      name: 'Sara Mahmoud',
      email: 's.mahmoud@lslcorp.com',
      role: 'Super Admin',
      lastLogin: '5 minutes ago',
      status: 'Active',
    },
    {
      name: 'Ali Rahman',
      email: 'a.rahman@lslcorp.com',
      role: 'Operations Manager',
      lastLogin: '32 minutes ago',
      status: 'Active',
    },
    {
      name: 'Fatima Ibrahim',
      email: 'f.ibrahim@lslcorp.com',
      role: 'Support Analyst',
      lastLogin: 'Yesterday 14:22 GST',
      status: 'Invited',
    },
    {
      name: 'Omar Hussein',
      email: 'o.hussein@lslcorp.com',
      role: 'Maintenance Lead',
      lastLogin: '2 days ago',
      status: 'Active',
    },
  ];

  badgeClass(status: UserSummary['status']): string {
    switch (status) {
      case 'Active':
        return 'bg-emerald-100 text-emerald-700';
      case 'Invited':
        return 'bg-amber-100 text-amber-700';
      case 'Suspended':
        return 'bg-rose-100 text-rose-700';
      default:
        return 'bg-slate-200 text-slate-700';
    }
  }
}
