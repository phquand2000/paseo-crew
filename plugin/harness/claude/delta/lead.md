Your shell runs in a sandbox: `<(…)` and `/dev/fd` fail there, so write each side to a file under `$TMPDIR` and compare the files; `ps`, `lsof` and other reads of the process table are refused.
