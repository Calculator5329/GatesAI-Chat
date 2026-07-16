#[cfg(any(target_os = "linux", test))]
use std::ffi::OsStr;

#[cfg(any(target_os = "linux", test))]
const DISABLE_DMABUF_ENV: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

#[cfg(any(target_os = "linux", test))]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct NvidiaProbeResults {
  proc_driver_version_exists: bool,
  drm_driver_is_nvidia: bool,
}

#[cfg(any(target_os = "linux", test))]
fn should_disable_dmabuf_renderer(
  is_linux: bool,
  probe: NvidiaProbeResults,
  existing_value: Option<&OsStr>,
) -> bool {
  is_linux
    && existing_value.is_none()
    && (probe.proc_driver_version_exists || probe.drm_driver_is_nvidia)
}

#[cfg(target_os = "linux")]
fn probe_nvidia_gpu() -> NvidiaProbeResults {
  use std::fs;
  use std::path::Path;

  let proc_driver_version_exists = Path::new("/proc/driver/nvidia/version").exists();
  let drm_driver_is_nvidia = fs::read_dir("/sys/class/drm")
    .into_iter()
    .flatten()
    .filter_map(Result::ok)
    .filter(|entry| entry.file_name().to_string_lossy().starts_with("card"))
    .filter_map(|entry| fs::read_link(entry.path().join("device/driver")).ok())
    .any(|target| target.to_string_lossy().to_ascii_lowercase().contains("nvidia"));

  NvidiaProbeResults {
    proc_driver_version_exists,
    drm_driver_is_nvidia,
  }
}

pub(crate) fn configure() {
  #[cfg(target_os = "linux")]
  {
    let existing_value = std::env::var_os(DISABLE_DMABUF_ENV);
    if should_disable_dmabuf_renderer(true, probe_nvidia_gpu(), existing_value.as_deref()) {
      std::env::set_var(DISABLE_DMABUF_ENV, "1");
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn disables_renderer_when_nvidia_proc_driver_is_present() {
    let probe = NvidiaProbeResults {
      proc_driver_version_exists: true,
      drm_driver_is_nvidia: false,
    };

    assert!(should_disable_dmabuf_renderer(true, probe, None));
  }

  #[test]
  fn disables_renderer_when_nvidia_drm_driver_is_present() {
    let probe = NvidiaProbeResults {
      proc_driver_version_exists: false,
      drm_driver_is_nvidia: true,
    };

    assert!(should_disable_dmabuf_renderer(true, probe, None));
  }

  #[test]
  fn leaves_renderer_alone_when_nvidia_is_absent() {
    assert!(!should_disable_dmabuf_renderer(
      true,
      NvidiaProbeResults::default(),
      None,
    ));
  }

  #[test]
  fn respects_existing_enabled_workaround_value() {
    let probe = NvidiaProbeResults {
      proc_driver_version_exists: true,
      drm_driver_is_nvidia: false,
    };

    assert!(!should_disable_dmabuf_renderer(
      true,
      probe,
      Some(OsStr::new("1")),
    ));
  }

  #[test]
  fn respects_existing_opt_out_value() {
    let probe = NvidiaProbeResults {
      proc_driver_version_exists: true,
      drm_driver_is_nvidia: false,
    };

    assert!(!should_disable_dmabuf_renderer(
      true,
      probe,
      Some(OsStr::new("0")),
    ));
  }

  #[test]
  fn is_a_no_op_on_non_linux_targets() {
    let probe = NvidiaProbeResults {
      proc_driver_version_exists: true,
      drm_driver_is_nvidia: true,
    };

    assert!(!should_disable_dmabuf_renderer(false, probe, None));
  }
}
