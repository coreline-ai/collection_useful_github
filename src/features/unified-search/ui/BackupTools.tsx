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
      <div className="backup-tool-item">
        <button
          type="button"
          className="btn btn-secondary"
          aria-describedby="backup-export-tooltip"
          onClick={() => void onExportBackup()}
          disabled={loading}
        >
          백업 내보내기
        </button>
        <span id="backup-export-tooltip" role="tooltip" className="backup-tooltip">
          현재 통합 데이터를 JSON 파일로 내려받습니다.
        </span>
      </div>
      <div className="backup-tool-item">
        <button
          type="button"
          className="btn btn-secondary"
          aria-describedby="backup-import-tooltip"
          onClick={() => importInputRef.current?.click()}
          disabled={loading}
        >
          백업 복원
        </button>
        <span id="backup-import-tooltip" role="tooltip" className="backup-tooltip">
          백업 JSON 파일을 업로드해 데이터를 복원합니다.
        </span>
      </div>
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
