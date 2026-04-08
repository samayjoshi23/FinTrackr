import { CommonModule } from '@angular/common';
import { Component, input, model } from '@angular/core';
import { TransactionRecord } from '../../models/transaction.model';
import { Icon } from '../icon/icon';
import { Modal } from '../modal/modal';

@Component({
  selector: 'app-transaction-detail-modal',
  imports: [CommonModule, Modal, Icon],
  templateUrl: './transaction-detail-modal.html',
  styleUrl: './transaction-detail-modal.css',
})
export class TransactionDetailModal {
  readonly open = model(false);
  readonly transaction = input<TransactionRecord | null>(null);
  readonly currency = input<string>('INR');

  protected iconFor(t: TransactionRecord): string {
    if (t.icon) return t.icon;
    const c = (t.category ?? '').toLowerCase();
    if (c.includes('food') || c.includes('dining')) return 'utensils';
    if (c.includes('transport') || c.includes('travel')) return 'car-side';
    if (c.includes('bill') || c.includes('electric')) return 'notes';
    if (c.includes('entertain') || c.includes('stream')) return 'entertainment';
    return 'wallet';
  }

  protected sourceLabel(t: TransactionRecord): string {
    const s = t.source?.trim();
    if (s) return s.toUpperCase();
    const c = t.category?.trim();
    return c ? c.toUpperCase() : '—';
  }
}
