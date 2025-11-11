import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

interface InventoryItem {
  assetId: string;
  type: string;
  location: string;
  status: 'In Transit' | 'Installed' | 'Warehouse';
  lastMovement: string;
  assignedProject?: string;
}

@Component({
  selector: 'app-inventory-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './inventory-overview.component.html',
})
export class InventoryOverviewComponent {
  readonly items: InventoryItem[] = [
    {
      assetId: 'CAM-XL-42187',
      type: '4K Fixed Camera',
      location: 'Marasi Business District',
      status: 'Installed',
      lastMovement: 'Deployed · 2 days ago',
      assignedProject: 'Tower A',
    },
    {
      assetId: 'ENC-POE-18821',
      type: 'PoE Edge Encoder',
      location: 'Dubai Logistics Hub',
      status: 'In Transit',
      lastMovement: 'Dispatched · 1 hour ago',
      assignedProject: 'Inbound logistics',
    },
    {
      assetId: 'BAT-UPS-99012',
      type: 'Battery Backup Module',
      location: 'Central Warehouse',
      status: 'Warehouse',
      lastMovement: 'Inventory check · 6 hours ago',
    },
    {
      assetId: 'CAM-PTZ-55211',
      type: 'PTZ Camera',
      location: 'Harbour Heights',
      status: 'Installed',
      lastMovement: 'Firmware sync · 45 minutes ago',
      assignedProject: 'Crane deck',
    },
  ];

  statusColor(status: InventoryItem['status']): string {
    switch (status) {
      case 'Installed':
        return 'bg-emerald-100 text-emerald-700';
      case 'In Transit':
        return 'bg-amber-100 text-amber-700';
      case 'Warehouse':
        return 'bg-slate-200 text-slate-700';
    }

    return 'bg-slate-200 text-slate-700';
  }
}
