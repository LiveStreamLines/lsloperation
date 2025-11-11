import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

interface Metric {
  label: string;
  value: string;
  delta: string;
  tone: 'positive' | 'neutral' | 'negative';
}

interface TimelineItem {
  time: string;
  title: string;
  description: string;
  type: 'camera' | 'maintenance' | 'project' | 'inventory';
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  readonly metrics: Metric[] = [
    {
      label: 'Live cameras',
      value: '1,247',
      delta: '+38 this week',
      tone: 'positive',
    },
    {
      label: 'Projects on track',
      value: '64 / 72',
      delta: '+4 recovered',
      tone: 'positive',
    },
    {
      label: 'Maintenance SLA',
      value: '96.8%',
      delta: '-0.4% vs last week',
      tone: 'negative',
    },
    {
      label: 'Inventory readiness',
      value: '87%',
      delta: '14 orders pending',
      tone: 'neutral',
    },
  ];

  readonly timeline: TimelineItem[] = [
    {
      time: '12:42',
      title: 'Camera lens cleaned - Tower A North',
      description: 'Maintenance completed and verified with latest frame.',
      type: 'maintenance',
    },
    {
      time: '12:15',
      title: 'Inventory transfer dispatched',
      description: 'PoE encoder cluster shipped to Dubai Logistics Hub.',
      type: 'inventory',
    },
    {
      time: '11:50',
      title: 'Project milestone reached',
      description: 'Harbour Heights structural phase completed at 92%.',
      type: 'project',
    },
    {
      time: '11:05',
      title: 'Camera offline alert',
      description: 'Logistics Gate node disconnected · field team notified.',
      type: 'camera',
    },
  ];

  metricToneClass(tone: Metric['tone']): string {
    switch (tone) {
      case 'positive':
        return 'text-emerald-600';
      case 'negative':
        return 'text-rose-600';
      default:
        return 'text-slate-500';
    }
  }

  timelineAccent(type: TimelineItem['type']): string {
    switch (type) {
      case 'camera':
        return 'bg-indigo-500';
      case 'maintenance':
        return 'bg-emerald-500';
      case 'project':
        return 'bg-sky-500';
      case 'inventory':
        return 'bg-amber-500';
    }

    return 'bg-slate-400';
  }
}
