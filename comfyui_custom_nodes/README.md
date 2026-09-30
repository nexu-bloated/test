# Remote ComfyUI install: checkpoint downloader

This application queues checkpoint downloads through `NexusCivitaiModelDownload`.
Install `nexus_civitai_download.py` on the remote ComfyUI machine:

1. Copy it to `<ComfyUI>/custom_nodes/nexus_civitai_download.py`.
2. Restart ComfyUI and confirm the startup log lists `NexusCivitaiModelDownload`.
3. Keep the existing node that registers `NexusCivitaiLoRADownload` installed; this patch does not replace or modify it.

Until this node is installed, checkpoint download requests fail clearly with
`Checkpoint download node is not installed on the remote ComfyUI machine.`
