---
status: implemented
date: 2026-09-24
task: T181
---

# A reading refreshes only the groups it measures

## The problem

`ProcessMetrics::measure` (`crates/mixengine-platform/src/metrics.rs`) serves every root from one
`System::refresh_processes(ProcessesToUpdate::All, true)`: the whole process table is refreshed so
that the parent map exists before any group is walked. `traits/metrics.rs` records what that costs —
about 10 ms on Windows and 2 ms on Linux — and the sampling periods were chosen against those two
numbers. **macOS was never measured, and it is the dear one.**

On macOS `sysinfo` 0.39 refreshes an existing process through `update_process`, which calls
`get_process_infos` unconditionally: two `sysctl(KERN_PROCARGS2)` calls per process, per refresh,
reading argv and the environment whatever `ProcessRefreshKind` asked for. A process whose executable
this account cannot read keeps `exe == None`, so `with_exe(OnlyIfNotSet)` retries its path lookup on
every refresh too. On a developer's Mac with about 700 processes:

- `one_refresh_costs` measures **about 9 ms** a refresh;
- a 20-second `sample` of an idle release `mixengined`, with the desktop Dashboard holding
  `/metrics` open, put most of its non-waiting samples under `Sampler::take` →
  `refresh_processes_specifics` → `get_process_infos` / `__sysctl` / `__proc_info`;
- the daemon spent a steady **~2% of one core**, mostly system time, measuring six processes.

The one-second rate is spent only while a client holds `/metrics`, and the desktop's half of this
(the Dashboard held it while the window was behind another application) is fixed separately. What
remains is that the one-second rate costs on macOS several times what the documents promise, and
that every tick pays for 700 processes to learn about six.

## The shape

Split the reading in two, and keep the walk a pure function over a table:

1. **Discovery — who is in each group.** A new crate-private `parent_table()` returns `pid → ppid`
   for every process on the machine, and nothing else, read the cheapest way the system offers:

   | System | Read | Cost |
   | --- | --- | --- |
   | macOS | `proc_listallpids`, then `proc_pidinfo(PROC_PIDT_SHORTBSDINFO)`'s `pbsi_ppid` per pid | one small call per process |
   | Linux | `/proc/<pid>/stat`, field 4, per numeric entry of `/proc` | one read per process |
   | Windows | one `CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS)`, `th32ParentProcessID` | one snapshot |

   **Not `sysctl(KERN_PROC_ALL)` on macOS**, although it is one call: `libc` does not define
   `kinfo_proc` for Apple, and a 648-byte struct restated by hand is a layout this crate would be
   trusting rather than checking. `proc_bsdshortinfo` is in `libc`, and one short read per process
   is still a fraction of the five `sysinfo` makes. The Windows read needs `windows-sys`'
   `Win32_System_Diagnostics_ToolHelp` feature — a feature of a crate already required, not a new
   dependency. The existing iterative walk (with its `seen` set and its stop at another subject's
   root) runs over this table to produce each group's members.

2. **Measurement — only the members.** `sysinfo` is refreshed with
   `ProcessesToUpdate::Some(&members)`, `remove_dead = true`, and a kind of CPU and memory only. The
   rows are summed exactly as today. `previous` keeps meaning *the pids the last refresh saw*, so a
   root seen for the first time still has no CPU figure.

**All three systems gain, for different reasons.** On Windows `sysinfo` still takes one
`NtQuerySystemInformation` of the whole system when given `Some(pids)`, but it opens and reads only
the processes that pass the filter — and opening every process is where the 10 ms goes. On macOS
the argv reads disappear with everyone outside the groups. Linux, already the cheapest, reads one
`stat` per process instead of several files.

**A failed discovery falls back to today's path.** `parent_table()` returning an error — `/proc`
unreadable, a `sysctl` that fails — makes that tick refresh `All` and walk `sysinfo`'s own parents,
exactly as now. It is a compiled, tested path on all three systems, not a `#[cfg]` in the sampler.

**The numbers stay comparable.** CPU and RSS still come from `sysinfo` on all three systems, which
is the property the module comment defends against a Job Object reading on Windows. Only *who is
asked* changes, and the members of a group are the same set either way.

## What changes, and what does not

- `ProcessMetrics::measure`'s signature and contract are unchanged; the daemon, the mock and the
  minute history see nothing new.
- `traits/metrics.rs`' *What one call costs* and `docs/features/resource-isolation.md`'s
  *Measuring, not guessing* gain the macOS number, before and after.
- **Stale entries.** A process that leaves every group but keeps running is never refreshed again,
  so `sysinfo` would keep its entry forever. The sampler drops its `System` and starts a new one
  when the set it holds is more than twice the set it measured, which costs one tick with no CPU
  figure for the groups, the same as a daemon start.
- **A child that arrives between discovery and measurement** is found on the next tick, as today.

## Testing

- The walk keeps its table tests; the table now comes from `parent_table()`'s shape rather than
  from `sysinfo` rows, and gains one test that members are exactly the walked set.
- `parent_table()` is tested against the running test process: it contains this pid, with the
  parent the system reports for it, on all three systems.
- `one_refresh_costs` stays the measurement, and is re-run on macOS for both documents.

## Out of scope

- The Dashboard holding `/metrics` while the window has no focus — fixed in the desktop.
- The sampling periods themselves (1 s and 60 s) — unchanged; this makes the fast one cheaper.
