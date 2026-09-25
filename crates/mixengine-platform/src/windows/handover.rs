//! Windows' half of [`crate::handover`]: a Job Object child, and `OsStr` as UTF-16.

use std::ffi::{OsStr, OsString};
use std::io;
use std::os::windows::ffi::{OsStrExt as _, OsStringExt as _};
use std::os::windows::io::AsRawHandle as _;
use std::path::Path;
use std::process::Command;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Console::{CTRL_BREAK_EVENT, CTRL_C_EVENT, SetConsoleCtrlHandler};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};
use windows_sys::core::BOOL;

use crate::{Error, Result};

/// A job that kills what is in it when this process lets go of it: the `KILL_ON_JOB_CLOSE` half of
/// `process::Group` and nothing else, because a shim sets no limits and this module may not need
/// the `process` feature.
struct Job(HANDLE);

impl Job {
    /// Put `process` in the job, and say whether Windows allowed it — see [`hand_over`] for why a
    /// refusal is not an error.
    fn assign(&self, process: HANDLE) -> bool {
        #[expect(
            unsafe_code,
            reason = "both handles are live for the duration of the call: the job is owned by this \
                      value and the process handle by the caller's `Child`"
        )]
        let assigned = unsafe { AssignProcessToJobObject(self.0, process) };

        assigned != 0
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        #[expect(
            unsafe_code,
            reason = "the handle is owned by this value and closed only here, once"
        )]
        unsafe {
            CloseHandle(self.0);
        }
    }
}

/// Create the job the program will be put into, before there is a program to put into it.
fn job() -> Result<Job> {
    #[expect(
        unsafe_code,
        reason = "two null pointers ask for an anonymous job with default security; nothing is \
                  borrowed"
    )]
    let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };

    if handle.is_null() {
        return Err(Error::Os {
            action: "create a job object for the program a shim starts",
            source: io::Error::last_os_error(),
        });
    }

    // Owned from here on, so the failure below closes it rather than leaking it.
    let job = Job(handle);

    #[expect(
        unsafe_code,
        reason = "every field of this struct is a number, so all-zero is a valid value of it"
    )]
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

    #[expect(
        unsafe_code,
        reason = "the pointer is to a local this frame owns and the length is that local's own \
                  size, so the kernel reads exactly the struct that is there"
    )]
    let set = unsafe {
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            std::ptr::from_ref(&limits).cast(),
            u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()).unwrap_or(u32::MAX),
        )
    };

    if set == 0 {
        return Err(Error::Os {
            action: "make the shim's job end what is in it when the shim ends",
            source: io::Error::last_os_error(),
        });
    }

    Ok(job)
}

/// Run `command` in this process's place, as close to an `exec` as this system gets.
///
/// The three steps are in the order they have to be in, and each is why the one before it is not
/// enough on its own:
///
/// 1. **The job first**, before the child exists, so there is something to put it into the moment it
///    does. [`job`]'s `KILL_ON_JOB_CLOSE` is what keeps a killed shim from leaving a `php -S`
///    holding a port.
/// 2. **The console handler before the spawn**, because the window between them is one where a
///    Ctrl-C would end this process by default and take the child down with the job.
/// 3. **The assignment after the spawn**, which is the one thing that cannot be done in the right
///    order — see `process::Group::adopt`. A failure is *not* propagated here, unlike everywhere else in
///    this module: a child that has already exited cannot be assigned and Windows says
///    `ERROR_ACCESS_DENIED` for it, which for a shim in front of `php -v` is the ordinary case
///    rather than an exotic one.
///
/// The standard handles are inherited rather than hidden — the opposite of every other spawn here,
/// and the point: this child *is* the program the user ran, so it writes to their terminal and reads
/// from their pipe.
pub(crate) fn hand_over(mut command: Command, program: &Path) -> Result<i32> {
    let job = job()?;
    ignore_console_interrupts()?;

    let mut child = command.spawn().map_err(|source| Error::Io {
        action: "run",
        path: program.to_path_buf(),
        source,
    })?;

    let _ = job.assign(child.as_raw_handle().cast());

    let status = child.wait().map_err(|source| Error::Os {
        action: "wait for the program it handed over to",
        source,
    })?;

    // `code` is `None` only for a process ended by something that is not an exit status, which on
    // this system means it was terminated — `TerminateProcess`, or the job being killed. 1 is what
    // a shell reads as "it did not work", and the alternative is inventing a zero for a program that
    // was killed.
    Ok(status.code().unwrap_or(1))
}

/// Stop this process from being ended by a Ctrl-C or a Ctrl-Break meant for the program it started.
///
/// **A console control event is broadcast, not routed.** Every process attached to the console gets
/// its own copy, so the child has already been told; what this prevents is *this* process acting on
/// its copy, since the default action would end the shim, close the job handle, and kill the child
/// in the same moment it was deciding what to do about the interrupt. A shell that has just had
/// Ctrl-C pressed in it would then see the prompt come back while the program it was running died
/// half way through writing a file.
///
/// **Only those two.** The handler answers `FALSE` for `CTRL_CLOSE_EVENT`, `CTRL_LOGOFF_EVENT` and
/// `CTRL_SHUTDOWN_EVENT`, which passes them to the default handler and ends this process — and that
/// is right: the window is gone, and a child that survived it would be exactly the orphan the job
/// object exists to prevent.
fn ignore_console_interrupts() -> Result<()> {
    /// Says "handled, and I am doing nothing about it" for the two events the child gets a copy of.
    ///
    /// Async-signal-safety has no Windows equivalent, but the constraint is the same in spirit: this
    /// runs on a thread the OS creates inside this process, so it touches nothing and allocates
    /// nothing.
    #[expect(
        unsafe_code,
        reason = "the unsafety is the signature Windows calls this through and nothing in the body, \
                  which reads one integer argument and returns another"
    )]
    unsafe extern "system" fn ignore(event: u32) -> BOOL {
        BOOL::from(matches!(event, CTRL_C_EVENT | CTRL_BREAK_EVENT))
    }

    #[expect(
        unsafe_code,
        reason = "the routine is a function of this module with the signature Windows documents, \
                  and adding a handler only appends to a per-process list"
    )]
    let registered = unsafe { SetConsoleCtrlHandler(Some(ignore), 1) };

    if registered == 0 {
        return Err(Error::Os {
            action: "keep a Ctrl-C from ending the shim before the program it started",
            source: io::Error::last_os_error(),
        });
    }

    Ok(())
}

/// An `OsStr` as the record carries it: its UTF-16 code units, little-endian.
pub(crate) fn os_bytes(value: &OsStr) -> Vec<u8> {
    value.encode_wide().flat_map(u16::to_le_bytes).collect()
}

/// What [`os_bytes`] wrote, back as an `OsString` — lone surrogates included.
pub(crate) fn os_string(bytes: &[u8]) -> Result<OsString> {
    let (pairs, odd) = bytes.as_chunks::<2>();

    if !odd.is_empty() {
        return Err(crate::handover::malformed(
            "an odd number of bytes for UTF-16",
        ));
    }

    let wide: Vec<u16> = pairs.iter().map(|pair| u16::from_le_bytes(*pair)).collect();

    Ok(OsString::from_wide(&wide))
}

/// A lone surrogate: a valid Windows string that is not Unicode.
#[cfg(test)]
pub(crate) fn not_unicode_for_tests() -> OsString {
    OsString::from_wide(&[0x0070, 0xD800, 0x0068])
}
