import {
  Store,
  Wifi,
  WifiOff,
  Lock,
  Unlock,
  Coins,
  Settings,
  RefreshCw,
  Barcode,
  FileSpreadsheet,
} from 'lucide-react';
import type { PosShift, PosRegister } from '@/types/pos';

interface PosHeaderProps {
  currentShift: PosShift | null;
  activeRegister?: PosRegister | null;
  branchName?: string;
  isOnline: boolean;
  pendingOfflineCount: number;
  isSyncing?: boolean;
  canViewOwnerDashboard?: boolean;
  canManageRegisters?: boolean;
  onOpenShiftModal: () => void;
  onOpenCashMovementModal: () => void;
  onOpenHistoryModal: () => void;
  onOpenOwnerAnalytics?: () => void;
  onOpenSettingsModal?: () => void;
  onOpenLabelGenerator?: () => void;
  onOpenZReport?: () => void;
  onSyncOfflineSales: () => Promise<void>;
  viewMode?: 'sales' | 'analytics' | 'history' | 'settings';
  onSelectViewMode?: (mode: 'sales' | 'analytics' | 'history' | 'settings') => void;
}

export function PosHeader({
  currentShift,
  activeRegister,
  branchName = 'Main Branch',
  isOnline,
  pendingOfflineCount,
  isSyncing = false,
  canViewOwnerDashboard = false,
  canManageRegisters = false,
  onOpenShiftModal,
  onOpenCashMovementModal,
  onOpenHistoryModal,
  onOpenOwnerAnalytics,
  onOpenSettingsModal,
  onOpenLabelGenerator,
  onOpenZReport,
  onSyncOfflineSales,
  viewMode = 'sales',
  onSelectViewMode,
}: PosHeaderProps) {
  const isShiftOpen = currentShift && currentShift.status === 'open';

  return (
    <header className="h-16 border-b border-gray-200 bg-white px-4 flex items-center justify-between gap-4 shadow-2xs select-none">
      {/* Left: Store & Register info */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-xs">
          <Store className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-black text-gray-900 tracking-tight">Ledgr POS</h1>
            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-700">
              {branchName}
            </span>
            {activeRegister && (
              <span className="rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                {activeRegister.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
            {isShiftOpen ? (
              <span className="flex items-center gap-1 font-bold text-emerald-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Shift Active (Opened{' '}
                {new Date(currentShift.opened_at || currentShift.start_time || '').toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                )
              </span>
            ) : (
              <span className="flex items-center gap-1 font-bold text-amber-600">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Shift Closed
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Middle: Navigation Mode Pills (if available) */}
      <div className="hidden md:flex items-center gap-1 rounded-2xl bg-gray-100 p-1">
        <button
          type="button"
          onClick={() => onSelectViewMode && onSelectViewMode('sales')}
          className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
            viewMode === 'sales' ? 'bg-white text-gray-900 shadow-2xs' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          Register Sales
        </button>
        <button
          type="button"
          onClick={() => {
            if (onSelectViewMode) onSelectViewMode('history');
            else onOpenHistoryModal();
          }}
          className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
            viewMode === 'history' ? 'bg-white text-gray-900 shadow-2xs' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          Sales History & Returns
        </button>
        {canViewOwnerDashboard && (
          <button
            type="button"
            onClick={() => {
              if (onSelectViewMode) onSelectViewMode('analytics');
              else if (onOpenOwnerAnalytics) onOpenOwnerAnalytics();
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
              viewMode === 'analytics' ? 'bg-white text-brand-700 shadow-2xs' : 'text-gray-500 hover:text-brand-600'
            }`}
          >
            Owner Analytics
          </button>
        )}
      </div>

      {/* Right: Actions, Online/Offline badge, Shift management */}
      <div className="flex items-center gap-2">
        {/* Offline / Online indicator & sync button */}
        {isOnline ? (
          pendingOfflineCount > 0 ? (
            <button
              type="button"
              onClick={onSyncOfflineSales}
              disabled={isSyncing}
              className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-800 border border-amber-200 hover:bg-amber-100"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Sync ({pendingOfflineCount})</span>
            </button>
          ) : (
            <div className="flex items-center gap-1 rounded-xl bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 border border-emerald-200">
              <Wifi className="h-3.5 w-3.5 text-emerald-600" />
              <span>Online</span>
            </div>
          )
        ) : (
          <div className="flex items-center gap-1 rounded-xl bg-red-50 px-2.5 py-1.5 text-[11px] font-bold text-red-700 border border-red-200 animate-pulse">
            <WifiOff className="h-3.5 w-3.5 text-red-600" />
            <span>Offline ({pendingOfflineCount} queued)</span>
          </div>
        )}

        {/* Barcode & Price Tag Labels button */}
        {onOpenLabelGenerator && (
          <button
            type="button"
            onClick={onOpenLabelGenerator}
            title="Print Product Barcode Labels & Shelf Tags"
            className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 px-2.5 py-1.5 text-xs font-bold text-gray-700 shadow-2xs"
          >
            <Barcode className="h-3.5 w-3.5 text-brand-600" />
            <span className="hidden xl:inline">Labels</span>
          </button>
        )}

        {/* End-of-Day Z-Report Button */}
        {currentShift && onOpenZReport && (
          <button
            type="button"
            onClick={onOpenZReport}
            title="End-of-Day Z-Report Audit Summary"
            className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 px-2.5 py-1.5 text-xs font-bold text-gray-700 shadow-2xs"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            <span className="hidden xl:inline">Z-Report</span>
          </button>
        )}

        {/* Cash In / Out Button (available when shift is active) */}
        {isShiftOpen && (
          <button
            type="button"
            onClick={onOpenCashMovementModal}
            className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-700 shadow-2xs"
          >
            <Coins className="h-3.5 w-3.5 text-brand-600" />
            <span className="hidden sm:inline">Cash In/Out</span>
          </button>
        )}

        {/* Shift Toggle Button */}
        <button
          type="button"
          onClick={onOpenShiftModal}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black shadow-2xs transition-all active:scale-95 ${
            isShiftOpen
              ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
              : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }`}
        >
          {isShiftOpen ? (
            <>
              <Lock className="h-3.5 w-3.5" />
              <span>Close Shift</span>
            </>
          ) : (
            <>
              <Unlock className="h-3.5 w-3.5" />
              <span>Open Shift</span>
            </>
          )}
        </button>

        {/* Settings button if authorized */}
        {canManageRegisters && onOpenSettingsModal && (
          <button
            type="button"
            onClick={onOpenSettingsModal}
            className="rounded-xl p-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-600"
          >
            <Settings className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  );
}
