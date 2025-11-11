import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

interface MediaMemory {
  title: string;
  project: string;
  capturedAt: string;
  contributor: string;
  tags: string[];
  url: string;
}

@Component({
  selector: 'app-memories-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './memories-overview.component.html',
})
export class MemoriesOverviewComponent {
  readonly memories: MediaMemory[] = [
    {
      title: 'Sunrise over Marasi Tower',
      project: 'Marasi Business District',
      capturedAt: '8 Nov 2024 · 06:12',
      contributor: 'Drone Ops Unit',
      tags: ['timelapse', 'marketing', 'drone'],
      url: '#',
    },
    {
      title: 'Logistics Hub expansion',
      project: 'Dubai Logistics Hub',
      capturedAt: '7 Nov 2024 · 18:40',
      contributor: 'Sara Mahmoud',
      tags: ['progress', 'ground'],
      url: '#',
    },
    {
      title: 'Harbour Heights night skyline',
      project: 'Harbour Heights',
      capturedAt: '5 Nov 2024 · 21:05',
      contributor: 'Marketing Studio',
      tags: ['night', 'marketing', 'lights'],
      url: '#',
    },
  ];
}
