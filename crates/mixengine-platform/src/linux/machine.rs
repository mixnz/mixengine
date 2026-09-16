//! Linux: the C library's own answer — roadmap task **T148**.
//!
//! Every Linux build of MixEngine targets `-gnu`, so the running process is itself proof that a
//! glibc is here; the only question is which.

use crate::{Machine, MachineFacts, Probe, avx, dotted_version};

/// This system's answer.
#[derive(Debug, Default)]
pub(crate) struct Facts;

impl Machine for Facts {
    fn facts(&self) -> MachineFacts {
        MachineFacts {
            glibc: glibc(),
            avx: avx(),
            ..MachineFacts::unknown()
        }
    }
}

fn glibc() -> Probe<String> {
    #[expect(
        unsafe_code,
        reason = "gnu_get_libc_version takes nothing and returns a pointer to a static, \
                  NUL-terminated string the C library owns for the life of the process"
    )]
    let text = unsafe { std::ffi::CStr::from_ptr(libc::gnu_get_libc_version()) };

    text.to_str().map_or(Probe::Unknown, dotted_version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_machine_names_its_c_library() {
        assert!(matches!(glibc(), Probe::Present(_)), "{:?}", glibc());
    }
}
