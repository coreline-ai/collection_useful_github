import type { RefObject } from 'react'

type BackupToolsProps = {
  loading: boolean
  importInputRef: RefObject<HTMLInputElement | null>
  onExportBackup: () => Promise<void>
  onImportBackupFile: (file: File | null) => Promise<void>
}

export const BackupTools = ({
  loading,
  importInputRef,
  onExportBackup,
  onImportBackupFile,
}: BackupToolsProps) => {
  return (
    <div className="backup-tools">
      <button type="button" onClick={() => void onExportBackup()} disabled={loading}>
        백업 내보내기
      </button>
      <button type="button" onClick={() => importInputRef.current?.click()} disabled={loading}>
        백업 복원
      </button>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          void onImportBackupFile(file)
        }}
      />
    </div>
  )
}
