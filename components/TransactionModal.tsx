
import React, { useState } from 'react';
import { Transaction, TransactionStatus, User, AuditLogItem, BankTransactionType } from '../types';
import { formatCurrency, formatDate, formatDateForPrint, formatCurrencyToWords, calculateInterest, formatNumberWithComma, parseNumberFromComma } from '../utils/helpers';
import { X, Wallet, FileText, CheckCircle, Clock, History, CreditCard, Scale, Printer, Undo2, ArrowDownCircle, Edit2, Save, Plus } from 'lucide-react';
import { GlassCard } from './GlassCard';

interface TransactionModalProps {
  transaction: Transaction | null;
  interestRate: number;
  projectCode?: string;
  interestStartDate?: string; // Ngày GN của dự án (Mốc tính lãi)
  onClose: () => void;
  onStatusChange: (id: string, status: TransactionStatus) => void;
  onRefund: (id: string, refundedAmount: number) => void;
  onUpdateTransaction: (transaction: Transaction) => void;
  currentUser: User;
  setAuditLogs: React.Dispatch<React.SetStateAction<AuditLogItem[]>>;
  handleAddBankTransaction: (type: BankTransactionType, amount: number, note: string, date: string) => void;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({ 
  transaction, 
  interestRate, 
  projectCode, 
  interestStartDate, 
  onClose, 
  onStatusChange, 
  onRefund,
  onUpdateTransaction,
  currentUser,
  setAuditLogs,
  handleAddBankTransaction
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const [supplementaryAmount, setSupplementaryAmount] = useState(transaction?.supplementaryAmount || 0);
  const [supplementaryAmountInput, setSupplementaryAmountInput] = useState('');
  const [supplementaryNote, setSupplementaryNote] = useState(transaction?.supplementaryNote || '');
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editedTransaction, setEditedTransaction] = useState<Transaction | null>(null);
  const [localStatus, setLocalStatus] = useState(transaction?.status || TransactionStatus.PENDING);

  if (!transaction) return null;

  // Initialize edited transaction
  React.useEffect(() => {
    if (transaction) {
      setEditedTransaction({ ...transaction });
      // Luôn reset box tiền bổ sung về 0 khi mở modal (theo yêu cầu: box reset = 0 sau khi lưu)
      setSupplementaryAmount(0);
      setSupplementaryAmountInput('');
      setSupplementaryNote('');
      setLocalStatus(transaction.status);
    }
  }, [transaction]);

  const isDisbursed = localStatus === TransactionStatus.DISBURSED;
  const isHold = localStatus === TransactionStatus.HOLD;
  
  // Tính lãi
  // Prioritize specific transaction interest date (e.g. refund date) over project default
  const baseDate = transaction.effectiveInterestDate || interestStartDate;

  let interest = 0;
  let calcEndDate = new Date();

  if (isDisbursed && transaction.disbursementDate) {
    calcEndDate = new Date(transaction.disbursementDate);
    interest = calculateInterest(transaction.compensation.totalApproved, interestRate, baseDate, calcEndDate);
  } else if (!isDisbursed) {
    // Chưa giải ngân (bao gồm PENDING & HOLD): lãi tạm tính đến hôm nay
    calcEndDate = new Date();
    interest = calculateInterest(transaction.compensation.totalApproved, interestRate, baseDate, calcEndDate);
  }

  const supplementary = transaction.supplementaryAmount || 0;
  const totalAmount = transaction.compensation.totalApproved + interest + supplementary;
  
  // Display start date for interest logic
  const displayStartDate = baseDate ? new Date(new Date(baseDate).getTime() + 86400000) : null;

  const handleConfirmPayment = () => {
    if (!isDisbursed) {
      // Tự động chuyển sang trạng thái đã giải ngân
      onStatusChange(transaction.id, TransactionStatus.DISBURSED);
      setLocalStatus(TransactionStatus.DISBURSED);
    }
  };

  const handleRefundMoney = () => {
     const confirmMsg = `Xác nhận nạp lại ${formatCurrency(totalAmount)} vào quỹ?\n\n- Gốc mới: ${formatCurrency(totalAmount)}\n- Lãi: Reset về 0\n- Trạng thái: Tồn đọng/Giữ hộ\n- Bắt đầu tính lãi: Từ ngày mai`;
     if (window.confirm(confirmMsg)) {
        onRefund(transaction.id, totalAmount);
        setLocalStatus(TransactionStatus.HOLD);
        setShowHistory(true);
        // Sau khi nạp tiền, trạng thái sẽ tự động chuyển sang HOLD và nút nạp tiền sẽ mất
     }
  };

  const handleSaveSupplementary = () => {
    const parsedAmount = parseNumberFromComma(supplementaryAmountInput);
    if (parsedAmount !== 0) {
      const now = new Date();
      const currentSupplementary = transaction.supplementaryAmount || 0;
      const newSupplementaryTotal = currentSupplementary + parsedAmount;
      
      // Nạp/Điều chỉnh tiền bổ sung vào số dư tài khoản (có thể âm hoặc dương)
      handleAddBankTransaction(
        BankTransactionType.DEPOSIT, 
        parsedAmount, 
        `Bổ sung tiền cho hộ: ${transaction.household.name} - ${transaction.id}${supplementaryNote ? `. ${supplementaryNote}` : ''}`, 
        now.toISOString()
      );
      
      const updated = {
        ...transaction,
        supplementaryAmount: newSupplementaryTotal,
        supplementaryNote: supplementaryNote || transaction.supplementaryNote,
        history: [
          ...(transaction.history || []),
          {
            timestamp: now.toISOString(),
            action: 'Bổ sung tiền',
            details: `Đã bổ sung thêm ${formatCurrency(parsedAmount)}${supplementaryNote ? ` với ghi chú: ${supplementaryNote}` : ''}`,
            totalAmount: parsedAmount,
            actor: currentUser.name
          }
        ]
      };
      onUpdateTransaction(updated);
      
      // Log audit
      setAuditLogs(prev => [...prev, {
        id: `audit-${Date.now()}`,
        timestamp: now.toISOString(),
        actor: currentUser.name,
        role: currentUser.role,
        action: 'Bổ sung tiền',
        target: `Giao dịch ${transaction.id}`,
        details: `Bổ sung ${formatCurrency(parsedAmount)} cho hộ ${transaction.household.name}${supplementaryNote ? `. Ghi chú: ${supplementaryNote}` : ''}`
      }]);

      // Reset box sau khi lưu
      setSupplementaryAmount(0);
      setSupplementaryAmountInput('');
      setSupplementaryNote('');
    }
  };

  const handleSaveDetails = () => {
    if (editedTransaction) {
      const now = new Date();
      const updated = {
        ...editedTransaction,
        history: [
          ...(transaction.history || []),
          {
            timestamp: now.toISOString(),
            action: 'Cập nhật thông tin',
            details: 'Đã chỉnh sửa thông tin hồ sơ',
            actor: currentUser.name
          }
        ]
      };
      onUpdateTransaction(updated);
      setIsEditingDetails(false);
      
      // Log audit
      setAuditLogs(prev => [...prev, {
        id: `audit-${Date.now()}`,
        timestamp: now.toISOString(),
        actor: currentUser.name,
        role: currentUser.role,
        action: 'Cập nhật thông tin',
        target: `Giao dịch ${transaction.id}`,
        details: `Cập nhật thông tin hồ sơ ${transaction.household.name}`
      }]);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Generate QR Code URL using a simple API (no extra deps required)
  // Encodes: ID|AMOUNT|NAME for quick scanning verification
  const qrData = `${transaction.id}|${totalAmount}|${transaction.household.name}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200 print:p-0 print:bg-white print:static">
      
      {/* CSS for Printing */}
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 5mm !important;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body {
            margin: 0 !important;
            padding: 0 !important;
          }
          body * {
            visibility: hidden;
          }
          #printable-area, #printable-area * {
            visibility: visible !important;
          }
          #printable-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-height: 100vh !important;
            height: 100vh !important;
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
            color: black !important;
            page-break-after: avoid !important;
            page-break-inside: avoid !important;
            display: block !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
          }
          #printable-area > div {
            max-height: 100% !important;
            height: 100% !important;
            overflow: hidden !important;
            page-break-inside: avoid !important;
            box-sizing: border-box !important;
          }
          .no-print {
            display: none !important;
            visibility: hidden !important;
          }
          /* Hide Sidebar and Background blobs */
          nav, aside, .fixed.bottom-0, .fixed.top-0 {
             display: none !important;
             visibility: hidden !important;
          }
        }
      `}</style>

      {/* --- PRINTABLE RECEIPT TEMPLATE (Hidden on screen, Visible on print) --- */}
      <div id="printable-area" className="hidden print:block print:visible" style={{ display: 'none' }}>
        <div className="w-full h-full p-2 flex flex-col justify-between" style={{ fontFamily: 'Arial, sans-serif', fontSize: '10px', lineHeight: '1.2', color: '#000', padding: '8px', boxSizing: 'border-box' }}>
          {/* Header */}
          <div className="text-center" style={{ marginBottom: '4px' }}>
            <p className="font-bold" style={{ fontSize: '11px', marginBottom: '1px', lineHeight: '1.2' }}>UBND xã Đông Anh</p>
            <p className="font-bold" style={{ fontSize: '11px', marginBottom: '1px', lineHeight: '1.2' }}>Ban quản lý Dự án đầu tư – hạ tầng</p>
            <p style={{ fontSize: '9px', marginBottom: '1px', lineHeight: '1.2' }}>Số 68 đường Cao Lỗ, xã Đông Anh, Hà Nội</p>
            <p className="font-bold" style={{ fontSize: '9px', lineHeight: '1.2' }}>Mẫu số C41 - BB</p>
          </div>

          {/* Title */}
          <div className="text-center" style={{ marginBottom: '4px' }}>
            <h1 className="font-bold uppercase" style={{ fontSize: '14px', marginBottom: '2px', lineHeight: '1.2' }}>PHIẾU CHI</h1>
            <div className="flex justify-between items-start" style={{ fontSize: '9px', lineHeight: '1.2' }}>
              <div className="text-left">
                <p>{formatDateForPrint(new Date().toISOString())}</p>
              </div>
              <div className="text-right">
                <p>Số: {transaction.id}</p>
              </div>
            </div>
          </div>

          {/* Quyết định số và Nợ/Có */}
          <div style={{ fontSize: '9px', marginBottom: '2px', lineHeight: '1.2' }}>
            <p style={{ marginBottom: '1px' }}>Quyết định số: {transaction.household.decisionNumber}</p>
            <div className="flex gap-4">
              <p>Nợ: {formatNumberWithComma(totalAmount).replace(/,/g, '.')}</p>
              <p>Có: {formatNumberWithComma(totalAmount).replace(/,/g, '.')}</p>
            </div>
          </div>

          {/* Họ và tên người nhận tiền */}
          <div style={{ fontSize: '9px', marginBottom: '2px', lineHeight: '1.2' }}>
            <p><strong>Họ và tên người nhận tiền:</strong> {transaction.household.name}</p>
          </div>

          {/* Địa chỉ */}
          <div style={{ fontSize: '9px', marginBottom: '2px', lineHeight: '1.2' }}>
            <p><strong>Địa chỉ:</strong> {transaction.household.address}</p>
          </div>

          {/* Nội dung */}
          <div style={{ fontSize: '9px', marginBottom: '2px', lineHeight: '1.2' }}>
            <p>
              <strong>Nội dung:</strong> Chi trả tiền bồi thường, hỗ trợ GPMB theo quyết định số {transaction.household.decisionNumber} ngày {formatDate(transaction.household.decisionDate)} thuộc dự án: {projectCode ? `(Mã dự án: ${projectCode})` : ''}
            </p>
          </div>

          {/* Số tiền */}
          <div style={{ fontSize: '9px', marginBottom: '2px', lineHeight: '1.2' }}>
            <p><strong>Số tiền:</strong> {formatNumberWithComma(totalAmount).replace(/,/g, '.')} đồng</p>
            <p style={{ marginTop: '1px' }}>
              <strong>Trong đó:</strong> Gốc {formatNumberWithComma(transaction.compensation.totalApproved).replace(/,/g, '.')} đồng
              {interest > 0 && <>; Lãi phát sinh {formatNumberWithComma(interest).replace(/,/g, '.')} đồng</>}
              {supplementary !== 0 && <>; Bổ sung {formatNumberWithComma(supplementary).replace(/,/g, '.')} đồng</>}
            </p>
          </div>

          {/* Viết bằng chữ */}
          <div style={{ fontSize: '9px', marginBottom: '2px', lineHeight: '1.2' }}>
            <p><strong>(Viết bằng chữ):</strong> {formatCurrencyToWords(totalAmount)} ./.</p>
          </div>

          {/* Kèm theo */}
          <div style={{ fontSize: '9px', marginBottom: '2px', lineHeight: '1.2' }}>
            <p><strong>Kèm theo:</strong> Chứng từ liên quan</p>
          </div>

          {/* Đã nhận đủ số tiền */}
          <div className="border-t border-black" style={{ fontSize: '9px', marginBottom: '4px', paddingTop: '2px', borderTopWidth: '1px', lineHeight: '1.2' }}>
            <p className="font-bold" style={{ marginBottom: '1px' }}>Đã nhận đủ số tiền</p>
            <p style={{ marginBottom: '1px' }}>- Bằng số: {formatNumberWithComma(totalAmount).replace(/,/g, '.')} đồng</p>
            <p>- Bằng chữ: {formatCurrencyToWords(totalAmount)}</p>
          </div>

          {/* Chữ ký */}
          <div className="flex justify-between items-end" style={{ fontSize: '9px', lineHeight: '1.2' }}>
            <div className="text-center flex-1">
              <p className="font-bold" style={{ marginBottom: '1px' }}>Người lập biểu</p>
              <p className="italic" style={{ fontSize: '8px', marginBottom: '8px' }}>(Ký, họ tên)</p>
              <p className="font-bold" style={{ fontSize: '9px' }}>{currentUser.name}</p>
            </div>
            <div className="text-center flex-1">
              <p className="font-bold" style={{ marginBottom: '1px' }}>Thủ quỹ</p>
              <p className="italic" style={{ fontSize: '8px', marginBottom: '8px' }}>(Ký, họ tên)</p>
              <p className="font-bold" style={{ fontSize: '9px' }}>Nguyễn Hương Ly</p>
            </div>
            <div className="text-center flex-1">
              <p className="font-bold" style={{ marginBottom: '1px' }}>Người nhận tiền</p>
              <p className="italic" style={{ fontSize: '8px', marginBottom: '8px' }}>(Ký, họ tên)</p>
              <p className="font-bold" style={{ fontSize: '9px' }}>{transaction.household.name}</p>
            </div>
          </div>

          {/* Ngày ký */}
          <div className="text-right" style={{ fontSize: '9px', marginTop: '2px', lineHeight: '1.2' }}>
            <p>{formatDateForPrint(new Date().toISOString())}</p>
          </div>
        </div>
      </div>

      {/* --- WEB UI --- */}
      <GlassCard className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col relative bg-white/95 border-slate-300 shadow-2xl ring-1 ring-black/5 no-print">
        
        {/* Header */}
        <div className="flex justify-between items-start p-6 border-b border-slate-200 bg-slate-50/80 backdrop-blur-md">
           <div>
              <div className="flex items-center gap-2 text-sm font-bold text-slate-500 mb-1 uppercase tracking-wider">
                <FileText size={14} />
                <span>Phiếu chi thông tin khách hàng</span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900">{transaction.household.name}</h2>
              <div className="flex items-center gap-2 mt-2">
                 <span className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${isDisbursed ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-amber-100 text-amber-700 border-amber-300'}`}>
                    {localStatus}
                 </span>
                 <span className="text-xs text-slate-500 font-medium ml-1">
                    ID: {transaction.id}
                 </span>
              </div>
           </div>
           <button 
             onClick={onClose}
             className="p-2 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
           >
             <X size={24} />
           </button>
        </div>

        {/* Content Body */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          
          {/* LEFT: Main Information */}
          <div className="flex-1 p-8 overflow-y-auto custom-scrollbar space-y-8 bg-white">
            
            {/* 1. Money Section */}
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                   {/* Approved */}
                   <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Tổng phê duyệt</p>
                      <p className="text-lg font-bold text-slate-800">{formatCurrency(transaction.compensation.totalApproved)}</p>
                   </div>
                   {/* Interest */}
                   <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Lãi phát sinh ({interestRate}%)</p>
                      <p className={`text-lg font-bold ${interest > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                        {interest > 0 ? '+' : ''}{formatCurrency(interest)}
                      </p>
                      <div className="text-[10px] text-slate-500 mt-1 font-medium flex items-center gap-1">
                        <Clock size={10} />
                        {isDisbursed 
                           ? `Chốt đến ${formatDate(transaction.disbursementDate || '')}` 
                           : (displayStartDate)
                              ? `Tính từ ${formatDate(displayStartDate.toISOString())}`
                              : 'Chưa bắt đầu tính lãi'
                        }
                      </div>
                  </div>
               </div>

               {/* Box Tiền bổ sung */}
               <div className="p-4 rounded-xl bg-blue-50 border border-blue-300">
                  <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Plus size={12} /> Số tiền bổ sung
                  </p>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={supplementaryAmountInput}
                      onChange={(e) => {
                        const value = e.target.value;
                        setSupplementaryAmountInput(value);
                        const parsed = parseNumberFromComma(value);
                        setSupplementaryAmount(parsed);
                      }}
                      onBlur={(e) => {
                        const parsed = parseNumberFromComma(e.target.value);
                        setSupplementaryAmountInput(formatNumberWithComma(parsed));
                      }}
                      className="w-full px-3 py-2 bg-white border border-blue-300 rounded-lg text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Nhập số tiền bổ sung (ví dụ: 1,000,000)"
                    />
                    <textarea
                      value={supplementaryNote}
                      onChange={(e) => setSupplementaryNote(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-blue-300 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Ghi chú..."
                      rows={2}
                    />
                    <button
                      onClick={handleSaveSupplementary}
                      disabled={parseNumberFromComma(supplementaryAmountInput) === 0}
                      className="w-full py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <Save size={14} />
                      Lưu tiền bổ sung
                    </button>
                  </div>
                  {transaction.supplementaryAmount && transaction.supplementaryAmount !== 0 && (
                    <div className="mt-2 p-2 bg-white rounded border border-blue-200">
                      <p className="text-xs font-bold text-blue-700">
                        Đã bổ sung: {formatCurrency(transaction.supplementaryAmount)}
                      </p>
                      {transaction.supplementaryNote && (
                        <p className="text-[10px] text-slate-600 mt-1">{transaction.supplementaryNote}</p>
                      )}
                    </div>
                  )}
               </div>

               {/* TOTAL BIG BOX - Professional Style */}
               <div className="p-6 rounded-2xl bg-slate-100 border border-slate-300 flex flex-col justify-center relative shadow-sm">
                  <div className="absolute top-4 right-4 text-slate-300">
                     <Wallet size={48} strokeWidth={1.5} />
                  </div>
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-2">Tổng số tiền thực nhận</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">{formatCurrency(totalAmount)}</p>
                  <p className="text-[11px] text-slate-500 mt-2 font-medium italic">
                     = Tổng phê duyệt + Lãi phát sinh {supplementary !== 0 ? `${supplementary > 0 ? '+ Tiền bổ sung' : '+ Giảm bổ sung'}` : ''} {interest === 0 && supplementary === 0 && '(Chưa tính)'}
                  </p>
               </div>
            </div>

            {/* 2. Details Grid */}
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xs font-bold text-slate-900 border-b border-slate-200 pb-2 uppercase tracking-wide flex-1">
                  Chi tiết hồ sơ
                </h3>
                {!isEditingDetails ? (
                  <button
                    onClick={() => setIsEditingDetails(true)}
                    className="ml-4 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-200 transition-all flex items-center gap-1 border border-slate-200"
                  >
                    <Edit2 size={12} />
                    Chỉnh sửa
                  </button>
                ) : (
                  <div className="ml-4 flex gap-2">
                    <button
                      onClick={() => {
                        setIsEditingDetails(false);
                        setEditedTransaction(transaction ? { ...transaction } : null);
                      }}
                      className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-200 transition-all border border-slate-200"
                    >
                      Hủy
                    </button>
                    <button
                      onClick={handleSaveDetails}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-all flex items-center gap-1"
                    >
                      <Save size={12} />
                      Lưu
                    </button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 transition-colors">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Mã dự án</p>
                    {isEditingDetails && editedTransaction ? (
                      <input
                        type="text"
                        value={projectCode || editedTransaction.projectId}
                        onChange={(e) => setEditedTransaction({...editedTransaction, projectId: e.target.value})}
                        className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-sm font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      <p className="text-sm font-bold text-slate-900 truncate" title={projectCode || transaction.projectId}>
                          {projectCode || transaction.projectId}
                      </p>
                    )}
                 </div>
                 <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 transition-colors">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Mã hộ dân</p>
                    {isEditingDetails && editedTransaction ? (
                      <input
                        type="text"
                        value={editedTransaction.household.id}
                        onChange={(e) => setEditedTransaction({
                          ...editedTransaction,
                          household: {...editedTransaction.household, id: e.target.value}
                        })}
                        className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-sm font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      <p className="text-sm font-bold text-slate-900 font-mono">{transaction.household.id}</p>
                    )}
                 </div>
                 <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 transition-colors">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1">
                        <CreditCard size={10} /> CCCD / CMND
                    </p>
                    {isEditingDetails && editedTransaction ? (
                      <input
                        type="text"
                        value={editedTransaction.household.cccd}
                        onChange={(e) => setEditedTransaction({
                          ...editedTransaction,
                          household: {...editedTransaction.household, cccd: e.target.value}
                        })}
                        className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-sm font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      <p className="text-sm font-bold text-slate-900 font-mono">{transaction.household.cccd}</p>
                    )}
                 </div>
                 <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 transition-colors">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1">
                        <Scale size={10} /> Số Quyết định
                    </p>
                    {isEditingDetails && editedTransaction ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          value={editedTransaction.household.decisionNumber}
                          onChange={(e) => setEditedTransaction({
                            ...editedTransaction,
                            household: {...editedTransaction.household, decisionNumber: e.target.value}
                          })}
                          className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-sm font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="date"
                          value={editedTransaction.household.decisionDate ? editedTransaction.household.decisionDate.split('T')[0] : ''}
                          onChange={(e) => setEditedTransaction({
                            ...editedTransaction,
                            household: {...editedTransaction.household, decisionDate: e.target.value}
                          })}
                          className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded text-[10px] font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-bold text-slate-900">{transaction.household.decisionNumber}</p>
                        <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                            Ngày: {formatDate(transaction.household.decisionDate)}
                        </p>
                      </>
                    )}
                 </div>
              </div>
            </div>

            {/* 3. History Section (Toggle) */}
            {showHistory && (
              <div className="animate-in slide-in-from-top-2 duration-300 pt-2">
                 <h3 className="text-xs font-bold text-slate-900 border-b border-slate-200 pb-2 mb-4 uppercase tracking-wide flex items-center gap-2">
                    <History size={14} /> Lịch sử giao dịch
                 </h3>
                 <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-4 max-h-[200px] overflow-y-auto custom-scrollbar">
                    {transaction.history && transaction.history.length > 0 ? (
                       transaction.history.map((log, idx) => (
                          <div key={idx} className="relative pl-4 border-l-2 border-slate-300 pb-2 last:pb-0">
                             <div className="absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full bg-slate-600 ring-2 ring-white"></div>
                             <div className="flex justify-between items-start">
                                <span className="text-xs font-bold text-slate-800">{log.action}</span>
                                <span className="text-[10px] font-mono text-slate-500">{new Date(log.timestamp).toLocaleString('vi-VN')}</span>
                             </div>
                             <p className="text-[11px] text-slate-600 mt-1 leading-snug">{log.details}</p>
                             {log.totalAmount && (
                                <p className="text-xs font-bold text-emerald-600 mt-1">
                                   {formatCurrency(log.totalAmount)}
                                </p>
                             )}
                          </div>
                       ))
                    ) : (
                       <p className="text-xs text-slate-400 italic text-center">Chưa có lịch sử giao dịch nào.</p>
                    )}
                 </div>
              </div>
            )}
          </div>

          {/* RIGHT: Actions */}
          <div className="w-full md:w-80 bg-slate-50 border-l border-slate-200 p-8 flex flex-col items-center justify-between">
            <div className="w-full text-center space-y-6">
               <div className="relative group mx-auto w-max" onClick={handlePrint}>
                 <div className="w-48 h-48 bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center justify-center relative overflow-hidden">
                    {/* Display Real QR Code if possible, otherwise use large icon */}
                    <img src={qrUrl} alt="Scan QR" className="w-full h-full object-contain" />
                 </div>
                 <div className="absolute inset-0 bg-blue-900/10 backdrop-blur-[1px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-xl cursor-pointer shadow-inner border border-slate-200">
                   <div className="bg-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
                      <Printer size={16} className="text-blue-600"/>
                      <span className="text-xs font-bold text-blue-700 uppercase tracking-wide">In phiếu chi</span>
                   </div>
                 </div>
               </div>
               
               <div>
                 <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Mã tham chiếu hệ thống</p>
                 <p className="text-xs font-mono font-bold text-slate-600 bg-slate-200/50 py-1.5 px-3 rounded-lg inline-block border border-slate-200">{transaction.id}</p>
               </div>
            </div>

            <div className="w-full space-y-3 mt-8">
               {!isDisbursed ? (
                  <button 
                    onClick={handleConfirmPayment}
                    className="w-full py-3.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-black transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-2 group border border-transparent"
                  >
                    <Wallet size={18} className="text-blue-400 group-hover:text-blue-300 transition-colors" />
                    Xác nhận chi trả
                  </button>
               ) : (
                  <>
                    {localStatus === TransactionStatus.DISBURSED ? (
                      <>
                        <button disabled className="w-full py-3.5 bg-emerald-600 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 cursor-default opacity-90 shadow-sm border border-emerald-700">
                          <CheckCircle size={18} />
                          Đã giải ngân
                        </button>
                        {/* Nút nạp tiền chỉ hiện khi đang ở trạng thái đã giải ngân */}
                        <button 
                          onClick={handleRefundMoney}
                          className="w-full py-2.5 bg-amber-50 text-amber-700 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-amber-100 transition-all border border-amber-200 shadow-sm"
                        >
                          <Undo2 size={14} />
                          Nạp tiền / Hoàn quỹ
                        </button>
                      </>
                    ) : (
                      // Sau khi nạp tiền, trạng thái sẽ là HOLD và nút nạp tiền/hoàn quỹ biến mất, hiển thị nút xác nhận lại
                      <button 
                        onClick={handleConfirmPayment}
                        className="w-full py-3.5 bg-blue-600 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-sm border border-blue-700"
                      >
                        <CheckCircle size={18} />
                        Xác nhận giải ngân
                      </button>
                    )}
                  </>
               )}

               <button 
                 onClick={() => setShowHistory(!showHistory)}
                 className={`w-full py-3.5 border rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                    showHistory 
                    ? 'bg-white border-slate-300 text-slate-900 shadow-sm' 
                    : 'bg-transparent border-slate-300 text-slate-600 hover:bg-white hover:shadow-sm'
                 }`}
               >
                  <History size={16} />
                  {showHistory ? 'Ẩn lịch sử' : 'Xem lịch sử'}
               </button>
            </div>
          </div>

        </div>
      </GlassCard>
    </div>
  );
};
