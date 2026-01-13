
import React from 'react';
import { TransactionStatus } from '../types';

interface StatusBadgeProps {
  status: TransactionStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  let styles = '';
  switch (status) {
    case TransactionStatus.DISBURSED:
      styles = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      break;
    case TransactionStatus.PENDING:
      styles = 'bg-amber-50 text-amber-700 border-amber-200';
      break;
    case TransactionStatus.HOLD:
      styles = 'bg-red-50 text-red-700 border-red-200';
      break;
    default:
      styles = 'bg-gray-100 text-gray-700 border-gray-200';
  }

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium border backdrop-blur-sm ${styles}`}>
      {status}
    </span>
  );
};
