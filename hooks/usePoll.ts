import { useState, useEffect, useCallback, useRef } from 'react';

interface PollChanges {
    timestamp: string;
    transactions?: any[];
    bank?: any[];
    projects?: any[];
}

interface UsePollOptions {
    interval?: number; // ms
    types?: string;
    enabled?: boolean;
    onChanges?: (changes: PollChanges) => void;
}

export const usePoll = (options: UsePollOptions = {}) => {
    const {
        interval = 5000,
        types = 'transactions,bank,projects',
        enabled = true,
        onChanges
    } = options;

    const [lastPoll, setLastPoll] = useState<string | null>(null);
    const [hasChanges, setHasChanges] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Use refs for values that shouldn't trigger effect re-runs
    const lastPollRef = useRef<string | null>(null);
    const isPollingRef = useRef(false);
    const onChangesRef = useRef(onChanges);

    // Update ref when onChanges changes
    useEffect(() => {
        onChangesRef.current = onChanges;
    }, [onChanges]);

    const poll = useCallback(async () => {
        if (isPollingRef.current) return;

        try {
            isPollingRef.current = true;
            setError(null);

            const since = lastPollRef.current || new Date(Date.now() - 60000).toISOString();
            const response = await fetch(`/api/events/poll?since=${encodeURIComponent(since)}&types=${types}`);

            if (!response.ok) {
                throw new Error('Poll failed');
            }

            const data = await response.json();

            if (data.success) {
                const newTimestamp = data.data?.timestamp || new Date().toISOString();
                lastPollRef.current = newTimestamp;
                setLastPoll(newTimestamp);

                if (data.hasChanges) {
                    setHasChanges(true);
                    onChangesRef.current?.(data.data);

                    // Reset hasChanges after a short delay
                    setTimeout(() => setHasChanges(false), 1000);
                }
            }
        } catch (err: any) {
            setError(err.message);
            console.error('Polling error:', err);
        } finally {
            isPollingRef.current = false;
        }
    }, [types]);

    useEffect(() => {
        if (!enabled) return;

        // Set up interval
        const intervalId = setInterval(poll, interval);

        return () => clearInterval(intervalId);
    }, [enabled, interval, poll]);

    return {
        lastPoll,
        hasChanges,
        isPolling: isPollingRef.current,
        error,
        poll // Manual trigger
    };
};

// Simple hook for dashboard auto-refresh
export const useDashboardPoll = (
    onRefresh: () => void,
    enabled: boolean = true
) => {
    return usePoll({
        interval: 5000,
        types: 'transactions,bank',
        enabled,
        onChanges: (changes) => {
            // If there are transaction or bank changes, trigger refresh
            if (changes.transactions?.length || changes.bank?.length) {
                console.log('📡 Changes detected, refreshing...');
                onRefresh();
            }
        }
    });
};
