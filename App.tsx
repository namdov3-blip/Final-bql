
import React, { useState, useEffect, useCallback } from 'react';
import { HashRouter } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Projects } from './pages/Projects';
import { TransactionList } from './pages/TransactionList';
import { TransactionModal } from './components/TransactionModal';
import { BankBalance } from './pages/BankBalance';
import { Admin } from './pages/Admin';
import { Login } from './pages/Login';
import { 
  Transaction, 
  TransactionStatus, 
  Project, 
  TransactionLog, 
  User, 
  AuditLogItem, 
  InterestHistoryLog, 
  BankAccount, 
  BankTransaction, 
  BankTransactionType 
} from './types';
import { calculateInterest, formatCurrency } from './utils/helpers';

const DB_KEYS = {
  TRANSACTIONS: 'namwspace_transactions',
  PROJECTS: 'namwspace_projects',
  USERS: 'namwspace_users',
  AUDIT_LOGS: 'namwspace_audit_logs',
  BANK_ACCOUNT: 'namwspace_bank_account',
  BANK_TRANSACTIONS: 'namwspace_bank_transactions',
  CONFIG_RATE: 'namwspace_interest_rate',
  CONFIG_HISTORY: 'namwspace_interest_history'
};

const DEFAULT_ADMIN: User = {
  id: 'admin-001',
  name: 'Quản trị viên',
  role: 'Admin',
  avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin',
  permissions: ['dashboard', 'projects', 'balance', 'transactions', 'reports', 'admin'],
  password: 'admin'
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [interestRate, setInterestRate] = useState<number>(() => Number(localStorage.getItem(DB_KEYS.CONFIG_RATE) || '6.5'));
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('namwspace_current_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [transactions, setTransactions] = useState<Transaction[]>(() => 
    JSON.parse(localStorage.getItem(DB_KEYS.TRANSACTIONS) || '[]'));
  
  const [projects, setProjects] = useState<Project[]>(() => 
    JSON.parse(localStorage.getItem(DB_KEYS.PROJECTS) || '[]'));
  
  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem(DB_KEYS.USERS);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Đảm bảo DEFAULT_ADMIN luôn có trong danh sách
      const hasAdmin = parsed.find((u: User) => u.id === DEFAULT_ADMIN.id);
      if (!hasAdmin) {
        return [DEFAULT_ADMIN, ...parsed];
      }
      return parsed;
    }
    return [DEFAULT_ADMIN];
  });

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('namwspace_current_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('namwspace_current_user');
    }
  }, [currentUser]);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    // Log audit - Lịch sử đăng nhập
    const now = new Date();
    setAuditLogs(prev => [...prev, {
      id: `audit-${Date.now()}`,
      timestamp: now.toISOString(),
      actor: user.name,
      role: user.role,
      action: 'Đăng nhập',
      target: 'Hệ thống',
      details: `Người dùng ${user.name} (${user.role}) đã đăng nhập vào hệ thống`
    }]);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setActiveTab('dashboard');
  };
  
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>(() => 
    JSON.parse(localStorage.getItem(DB_KEYS.AUDIT_LOGS) || '[]'));

  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>(() => {
    const saved = localStorage.getItem(DB_KEYS.BANK_TRANSACTIONS);
    if (saved) return JSON.parse(saved);
    return [];
  });

  const [bankAccount, setBankAccount] = useState<BankAccount>(() => {
    const saved = localStorage.getItem(DB_KEYS.BANK_ACCOUNT);
    if (saved) return JSON.parse(saved);
    return { openingBalance: 0, currentBalance: 0, reconciledBalance: 0 };
  });

  const [interestHistory, setInterestHistory] = useState<InterestHistoryLog[]>(() => 
    JSON.parse(localStorage.getItem(DB_KEYS.CONFIG_HISTORY) || '[]'));

  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [transactionSearchTerm, setTransactionSearchTerm] = useState('');

  useEffect(() => {
    localStorage.setItem(DB_KEYS.TRANSACTIONS, JSON.stringify(transactions));
    localStorage.setItem(DB_KEYS.PROJECTS, JSON.stringify(projects));
    localStorage.setItem(DB_KEYS.USERS, JSON.stringify(users));
    localStorage.setItem(DB_KEYS.AUDIT_LOGS, JSON.stringify(auditLogs));
    localStorage.setItem(DB_KEYS.BANK_ACCOUNT, JSON.stringify(bankAccount));
    localStorage.setItem(DB_KEYS.BANK_TRANSACTIONS, JSON.stringify(bankTransactions));
    localStorage.setItem(DB_KEYS.CONFIG_RATE, interestRate.toString());
    localStorage.setItem(DB_KEYS.CONFIG_HISTORY, JSON.stringify(interestHistory));
  }, [transactions, projects, users, auditLogs, bankAccount, bankTransactions, interestRate, interestHistory]);

  // Cập nhật số tiền nạp ban đầu trong lịch sử giao dịch dòng tiền khi lãi suất thay đổi
  const prevInterestRateRef = React.useRef<number>(interestRate);
  useEffect(() => {
    // Chỉ cập nhật khi lãi suất thực sự thay đổi (không phải lần đầu mount)
    if (prevInterestRateRef.current === interestRate) return;
    prevInterestRateRef.current = interestRate;

    if (bankTransactions.length === 0 || projects.length === 0) return;

    // Tìm tất cả các giao dịch nạp tiền ban đầu (DEPOSIT) liên quan đến dự án
    const depositTxs = bankTransactions.filter(tx => 
      tx.type === BankTransactionType.DEPOSIT && 
      tx.note.includes('Tiền chưa giải ngân dự án')
    );

    if (depositTxs.length === 0) return;

    // Cập nhật từng giao dịch nạp tiền
    let hasChanges = false;
    const updatedTxs = bankTransactions.map(tx => {
      if (tx.type === BankTransactionType.DEPOSIT && tx.note.includes('Tiền chưa giải ngân dự án')) {
        // Tìm mã dự án từ note
        const match = tx.note.match(/dự án ([A-Z0-9-]+)/);
        if (!match) return tx;
        
        const projectCode = match[1];
        const project = projects.find(p => p.code === projectCode);
        if (!project) return tx;

        // Tính lại lãi tạm tính với lãi suất mới (CHỈ cho các giao dịch chưa giải ngân)
        const projectTransactions = transactions.filter(t => t.projectId === project.id);
        const now = new Date();
        let totalInterest = 0;
        let totalSupplementary = 0;
        
        projectTransactions.forEach(transaction => {
          // Chỉ tính lãi cho các giao dịch chưa giải ngân
          if (transaction.status !== TransactionStatus.DISBURSED) {
            const baseDate = transaction.effectiveInterestDate || project.interestStartDate;
            if (baseDate) {
              totalInterest += calculateInterest(transaction.compensation.totalApproved, interestRate, baseDate, now);
            }
            totalSupplementary += transaction.supplementaryAmount || 0;
          }
        });

        // Tính tổng gốc của các giao dịch chưa giải ngân
        const totalPrincipal = projectTransactions
          .filter(t => t.status !== TransactionStatus.DISBURSED)
          .reduce((sum, t) => sum + t.compensation.totalApproved, 0);

        const newAmount = totalPrincipal + totalInterest + totalSupplementary;
        
        // Chỉ cập nhật nếu số tiền thay đổi
        if (Math.abs(tx.amount - newAmount) > 0.01) {
          hasChanges = true;
          return {
            ...tx,
            amount: newAmount,
            note: `Tiền chưa giải ngân dự án ${project.code}${totalInterest > 0 || totalSupplementary > 0 ? ` (Gốc: ${formatCurrency(totalPrincipal)}${totalInterest > 0 ? ` + Lãi: ${formatCurrency(totalInterest)}` : ''}${totalSupplementary > 0 ? ` + Bổ sung: ${formatCurrency(totalSupplementary)}` : ''})` : ''}`
          };
        }
      }
      return tx;
    });

    if (hasChanges) {
      // Tính lại runningBalance cho tất cả các giao dịch
      let runningBalance = 0;
      const finalUpdatedTxs = updatedTxs.map(tx => {
        runningBalance += tx.amount;
        return { ...tx, runningBalance };
      });

      setBankTransactions(finalUpdatedTxs);
      
      // Cập nhật currentBalance
      const lastTx = finalUpdatedTxs[finalUpdatedTxs.length - 1];
      if (lastTx) {
        setBankAccount(prev => ({
          ...prev,
          currentBalance: lastTx.runningBalance
        }));
      }
    }
  }, [interestRate, projects, transactions]); // Chỉ chạy khi lãi suất, dự án hoặc giao dịch thay đổi

  const handleAddBankTransaction = useCallback((type: BankTransactionType, amount: number, note: string, date: string) => {
    // Lấy số dư hiện tại từ bankAccount (đã bao gồm lãi phát sinh) làm điểm khởi đầu
    // Đảm bảo tính nhất quán: số dư mới = số dư hiện tại + số tiền giao dịch
    const currentBalance = bankAccount.currentBalance;
    const newBalance = currentBalance + amount;
    
    const newTx: BankTransaction = {
      id: `BTX-${Date.now()}-${Math.floor(Math.random()*1000)}`,
      type,
      amount,
      date,
      note,
      createdBy: 'Hệ thống',
      runningBalance: newBalance
    };
    
    setBankTransactions(prev => [...prev, newTx]);
    setBankAccount(prevAcc => ({
      ...prevAcc,
      currentBalance: newBalance,
      reconciledBalance: type === BankTransactionType.ADJUSTMENT ? newBalance : prevAcc.reconciledBalance
    }));
  }, [bankAccount]);

  // --- TỰ ĐỘNG KẾT CHUYỂN LÃI (LOGIC NGÂN HÀNG: End - Start) ---
  useEffect(() => {
    const checkAndCapitalize = () => {
      if (bankTransactions.length === 0) return;

      const SIMULATED_TODAY = new Date(2026, 0, 10); // 10/01/2026
      const currentMonth = SIMULATED_TODAY.getMonth();
      const currentYear = SIMULATED_TODAY.getFullYear();

      const capitalizedMonths = bankTransactions
        .filter(tx => tx.note.includes('Tự động kết chuyển lãi tháng'))
        .map(tx => {
           const match = tx.note.match(/tháng (\d+)\/(\d+)/);
           return match ? `${match[1]}-${match[2]}` : null;
        });

      const firstTxDate = new Date(bankTransactions[0].date);
      let checkDate = new Date(firstTxDate.getFullYear(), firstTxDate.getMonth(), 1);

      while (checkDate < new Date(currentYear, currentMonth, 1)) {
        const m = checkDate.getMonth() + 1;
        const y = checkDate.getFullYear();
        const key = `${m}-${y}`;

        if (!capitalizedMonths.includes(key)) {
          // Ngày mùng 1 của tháng tiếp theo (Ngày đổ lãi về tài khoản)
          const capitalizationDate = new Date(y, m, 1);
          capitalizationDate.setHours(0, 0, 0, 0);
          
          const txsInPeriod = bankTransactions
            .filter(tx => new Date(tx.date) < capitalizationDate)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

          let monthlyInterest = 0;
          let daysInPeriod = 0;

          for (let i = 0; i < txsInPeriod.length; i++) {
            const currentTx = txsInPeriod[i];
            const nextTx = txsInPeriod[i + 1];
            
            const startCalcDate = new Date(currentTx.date);
            startCalcDate.setHours(0, 0, 0, 0);

            let endCalcDate = (nextTx && new Date(nextTx.date) < capitalizationDate) 
              ? new Date(nextTx.date) 
              : capitalizationDate;
            endCalcDate.setHours(0, 0, 0, 0);

            if (endCalcDate > startCalcDate) {
              const diffTime = endCalcDate.getTime() - startCalcDate.getTime();
              const days = Math.floor(diffTime / (1000 * 3600 * 24)); 
              
              if (days > 0) {
                daysInPeriod += days;
                const dailyRate = (interestRate / 100) / 365;
                monthlyInterest += (currentTx.runningBalance * dailyRate * days);
              }
            }
          }

          if (monthlyInterest > 0) {
            // Ngày nạp lãi là mùng 1 tháng mới
            const depositDate = new Date(y, m, 1).toISOString().split('T')[0];
            handleAddBankTransaction(
              BankTransactionType.DEPOSIT, 
              Math.round(monthlyInterest), 
              `Tự động kết chuyển lãi tháng ${m}/${y} (${daysInPeriod} ngày)`, 
              depositDate
            );
            capitalizedMonths.push(key);
          }
        }
        checkDate.setMonth(checkDate.getMonth() + 1);
      }
    };

    const timer = setTimeout(checkAndCapitalize, 1000);
    return () => clearTimeout(timer);
  }, [bankTransactions, interestRate, handleAddBankTransaction]);

  const handleStatusChange = (id: string, newStatus: TransactionStatus) => {
    const now = new Date();
    const updated = transactions.map(t => {
      if (t.id === id) {
        let updatedTransaction = { ...t, status: newStatus, history: t.history || [] };
        if (newStatus === TransactionStatus.DISBURSED && t.status !== TransactionStatus.DISBURSED) {
           updatedTransaction.disbursementDate = now.toISOString();
           const project = projects.find(p => p.id === t.projectId);
           const baseDate = t.effectiveInterestDate || project?.interestStartDate;
           const currentInterest = calculateInterest(t.compensation.totalApproved, interestRate, baseDate, now);
           const supplementaryAmount = t.supplementaryAmount || 0;
           const totalFinal = t.compensation.totalApproved + currentInterest + supplementaryAmount;
           // Trừ đủ số tiền (Gốc + Lãi + Bổ sung) khỏi bankAccount.currentBalance
           // Vì khi upload đã nạp đủ cả lãi vào tài khoản rồi
           handleAddBankTransaction(BankTransactionType.WITHDRAW, -totalFinal, `Chi trả dự án: ${project?.code} - Hộ: ${t.household.name}`, now.toISOString());
           updatedTransaction.history = [...updatedTransaction.history!, { timestamp: now.toISOString(), action: 'Xác nhận chi trả', details: `Giải ngân hồ sơ. Tổng: ${formatCurrency(totalFinal)}`, totalAmount: totalFinal, actor: currentUser.name }];
           // Log audit
           setAuditLogs(prev => [...prev, {
             id: `audit-${Date.now()}`,
             timestamp: now.toISOString(),
             actor: currentUser.name,
             role: currentUser.role,
             action: 'Xác nhận chi trả',
             target: `Giao dịch ${t.id}`,
             details: `Giải ngân ${formatCurrency(totalFinal)} cho hộ ${t.household.name}`
           }]);
        }
        return updatedTransaction;
      }
      return t;
    });
    setTransactions(updated);
  };

  const handleRefundTransaction = (id: string, refundedAmount: number) => {
    const now = new Date();
    const updated = transactions.map(t => {
      if (t.id === id) {
        handleAddBankTransaction(BankTransactionType.DEPOSIT, refundedAmount, `Hoàn quỹ hồ sơ: ${t.id}`, now.toISOString());
        const updatedT = {
          ...t, 
          status: TransactionStatus.HOLD, 
          compensation: { ...t.compensation, totalApproved: refundedAmount },
          disbursementDate: undefined, 
          effectiveInterestDate: now.toISOString(),
          supplementaryAmount: 0, // Reset tiền bổ sung
          supplementaryNote: undefined,
          history: [...(t.history || []), { timestamp: now.toISOString(), action: 'Nạp tiền / Hoàn quỹ', details: `Hoàn lại ${formatCurrency(refundedAmount)}`, totalAmount: refundedAmount, actor: currentUser.name }]
        };
        // Log audit
        setAuditLogs(prev => [...prev, {
          id: `audit-${Date.now()}`,
          timestamp: now.toISOString(),
          actor: currentUser.name,
          role: currentUser.role,
          action: 'Nạp tiền / Hoàn quỹ',
          target: `Giao dịch ${t.id}`,
          details: `Hoàn lại ${formatCurrency(refundedAmount)} cho hộ ${t.household.name}`
        }]);
        return updatedT;
      }
      return t;
    });
    setTransactions(updated);
  };

  const handleUpdateTransaction = (updatedTransaction: Transaction) => {
    setTransactions(transactions.map(t => t.id === updatedTransaction.id ? updatedTransaction : t));
  };

  const handleImportProject = (p: Project, t: Transaction[]) => {
    const now = new Date();
    
    // 1. Lưu thông tin dự án và danh sách hộ dân
    setProjects([p, ...projects]);
    setTransactions([...transactions, ...t]);

    // 2. Tính tổng tiền cần nạp (Gốc + Lãi tạm tính + Tiền bổ sung)
    let totalInterest = 0;
    let totalSupplementary = 0;
    t.forEach(transaction => {
      const baseDate = transaction.effectiveInterestDate || p.interestStartDate;
      if (baseDate) {
        totalInterest += calculateInterest(transaction.compensation.totalApproved, interestRate, baseDate, now);
      }
      totalSupplementary += transaction.supplementaryAmount || 0;
    });
    
    const totalToDeposit = p.totalBudget + totalInterest + totalSupplementary;

    // 3. Tự động nạp tiền dự án vào số dư tài khoản
    // Nạp đủ số tiền bao gồm cả lãi tạm tính và tiền bổ sung để đồng nhất với "Số dư hiện tại"
    handleAddBankTransaction(
      BankTransactionType.DEPOSIT,
      totalToDeposit,
      `Tiền chưa giải ngân dự án ${p.code}${totalInterest > 0 || totalSupplementary > 0 ? ` (Gốc: ${formatCurrency(p.totalBudget)}${totalInterest > 0 ? ` + Lãi: ${formatCurrency(totalInterest)}` : ''}${totalSupplementary > 0 ? ` + Bổ sung: ${formatCurrency(totalSupplementary)}` : ''})` : ''}`,
      p.interestStartDate || new Date().toISOString()
    );

    // 3. Log audit - Lịch sử upload file
    setAuditLogs(prev => [...prev, {
      id: `audit-${Date.now()}`,
      timestamp: now.toISOString(),
      actor: currentUser?.name || 'Hệ thống',
      role: currentUser?.role || 'System',
      action: 'Upload file dữ liệu',
      target: `Dự án ${p.code}`,
      details: `Đã upload file và import dự án ${p.name} (${p.code}) với ${t.length} hộ dân. Tổng ngân sách: ${formatCurrency(p.totalBudget)}`
    }]);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard transactions={transactions} projects={projects} interestRate={interestRate} bankAccount={bankAccount} setActiveTab={setActiveTab} currentUser={currentUser} />;
      case 'projects': return <Projects projects={projects} transactions={transactions} interestRate={interestRate} onImport={handleImportProject} onUpdateProject={p => setProjects(projects.map(pj => pj.id === p.id ? p : pj))} onViewDetails={c => { setTransactionSearchTerm(c); setActiveTab('transactions'); }} />;
      case 'balance': return <BankBalance transactions={transactions} projects={projects} bankAccount={bankAccount} bankTransactions={bankTransactions} interestRate={interestRate} currentUser={currentUser} onAddBankTransaction={handleAddBankTransaction} onAdjustOpeningBalance={b => setBankAccount({...bankAccount, openingBalance: b, currentBalance: b, reconciledBalance: b})} setAuditLogs={setAuditLogs} />;
      case 'transactions': return <TransactionList transactions={transactions} projects={projects} interestRate={interestRate} onSelect={setSelectedTransaction} searchTerm={transactionSearchTerm} setSearchTerm={setTransactionSearchTerm} />;
      case 'admin': return <Admin auditLogs={auditLogs} users={users} onAddUser={u => setUsers([...users, u])} onUpdateUser={u => setUsers(users.map(us => us.id === u.id ? u : us))} interestRate={interestRate} onUpdateInterestRate={setInterestRate} interestHistory={interestHistory} currentUser={currentUser} setAuditLogs={setAuditLogs} setInterestHistory={setInterestHistory} />;
      default: return null;
    }
  };

  // Show login page if not logged in
  if (!currentUser) {
    return <Login users={users} onLogin={handleLogin} />;
  }

  return (
    <HashRouter>
      <div className="min-h-screen text-slate-800 font-sans selection:bg-blue-100 selection:text-blue-900">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} currentUser={currentUser} onLogout={handleLogout} />
        <main className="ml-64 p-8 min-h-screen relative bg-[#f8fafc]">
          {renderContent()}
        </main>
        {selectedTransaction && (
          <TransactionModal 
            transaction={selectedTransaction} 
            interestRate={interestRate}
            projectCode={projects.find(p => p.id === selectedTransaction.projectId)?.code}
            interestStartDate={projects.find(p => p.id === selectedTransaction.projectId)?.interestStartDate}
            onClose={() => setSelectedTransaction(null)}
            onStatusChange={handleStatusChange}
            onRefund={handleRefundTransaction}
            onUpdateTransaction={handleUpdateTransaction}
            currentUser={currentUser}
            setAuditLogs={setAuditLogs}
            handleAddBankTransaction={handleAddBankTransaction}
          />
        )}
      </div>
    </HashRouter>
  );
};

export default App;
