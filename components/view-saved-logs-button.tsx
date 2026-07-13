'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileText } from 'lucide-react';
import SavedLogsModal from '@/components/saved-logs-modal';

interface ViewSavedLogsButtonProps {
  transactionId: number;
  className?: string;
}

const ViewSavedLogsButton: React.FC<ViewSavedLogsButtonProps> = ({
  transactionId,
  className = ''
}) => {
  const [showSavedLogs, setShowSavedLogs] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setShowSavedLogs(true)}
        className={className}
      >
        <FileText className="w-4 h-4 mr-2" />
        Ver Logs Salvos
      </Button>

      <SavedLogsModal
        open={showSavedLogs}
        onOpenChange={setShowSavedLogs}
        transactionId={transactionId}
      />
    </>
  );
};

export default ViewSavedLogsButton;