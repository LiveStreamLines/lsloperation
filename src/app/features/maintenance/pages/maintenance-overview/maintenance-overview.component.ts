import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

interface MaintenanceTask {
  id: string;
  title: string;
  site: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  due: string;
  assignee: string;
  status: 'Scheduled' | 'In Progress' | 'Completed';
}

@Component({
  selector: 'app-maintenance-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './maintenance-overview.component.html',
})
export class MaintenanceOverviewComponent {
  readonly tasks: MaintenanceTask[] = [
    {
      id: 'MT-4821',
      title: 'Lens cleaning & calibration',
      site: 'Marasi Business District · Tower A',
      priority: 'High',
      due: 'Today · 18:00 GST',
      assignee: 'Sara Mahmoud',
      status: 'In Progress',
    },
    {
      id: 'MT-4816',
      title: 'Replace UPS module',
      site: 'Dubai Logistics Hub · Control Room',
      priority: 'Critical',
      due: 'Today · 14:00 GST',
      assignee: 'Field Ops Team',
      status: 'Scheduled',
    },
    {
      id: 'MT-4773',
      title: 'Firmware upgrade roll-out',
      site: 'Harbour Heights · Crane Cam',
      priority: 'Medium',
      due: 'Tomorrow · 10:30 GST',
      assignee: 'Omar Hussein',
      status: 'Scheduled',
    },
    {
      id: 'MT-4680',
      title: 'Cabinet inspection & dust proofing',
      site: 'Central Warehouse',
      priority: 'Low',
      due: 'Completed yesterday',
      assignee: 'Maintenance Crew',
      status: 'Completed',
    },
  ];

  priorityColor(priority: MaintenanceTask['priority']): string {
    switch (priority) {
      case 'Critical':
        return 'bg-rose-100 text-rose-700';
      case 'High':
        return 'bg-amber-100 text-amber-700';
      case 'Medium':
        return 'bg-indigo-100 text-indigo-700';
      case 'Low':
        return 'bg-slate-200 text-slate-700';
    }

    return 'bg-slate-200 text-slate-700';
  }

  statusColor(status: MaintenanceTask['status']): string {
    switch (status) {
      case 'Completed':
        return 'bg-emerald-100 text-emerald-700';
      case 'In Progress':
        return 'bg-blue-100 text-blue-700';
      case 'Scheduled':
        return 'bg-slate-200 text-slate-700';
    }

    return 'bg-slate-200 text-slate-700';
  }
}
