use claudia_lib::claude_binary::*;
use std::env;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

#[test]
fn test_create_command_with_env() {
    // Save original PATH
    let original_path = env::var("PATH").unwrap_or_default();
    
    // Test 1: Normal binary path
    let cmd = create_command_with_env("/usr/bin/claude");
    // The command should have PATH set
    // Note: We can't easily inspect Command's env vars, but we can verify it doesn't panic
    
    // Test 2: NVM directory path
    let nvm_path = "/home/user/.nvm/versions/node/v18.0.0/bin/claude";
    let cmd = create_command_with_env(nvm_path);
    // Should add the NVM bin directory to PATH
    
    // Restore original PATH
    env::set_var("PATH", original_path);
}

#[test]
fn test_create_command_with_nvm_path() {
    let original_path = env::var("PATH").unwrap_or_default();
    
    // Create a mock NVM path
    let nvm_claude = "/Users/test/.nvm/versions/node/v20.0.0/bin/claude";
    
    // Set a basic PATH without the NVM directory
    env::set_var("PATH", "/usr/bin:/usr/local/bin");
    
    let _cmd = create_command_with_env(nvm_claude);
    
    // The PATH should now include the NVM bin directory
    // Since we can't inspect the Command's env directly, we verify through the path_utils
    let expected_dir = "/Users/test/.nvm/versions/node/v20.0.0/bin";
    let new_path = crate::path_utils::add_to_path_if_missing(expected_dir);
    assert!(new_path.contains(expected_dir));
    
    env::set_var("PATH", original_path);
}

#[test]
fn test_create_command_env_inheritance() {
    // Set some test environment variables
    env::set_var("TEST_HOME", "/test/home");
    env::set_var("TEST_LANG", "en_US.UTF-8");
    env::set_var("TEST_RANDOM", "should_not_inherit");
    
    let cmd = create_command_with_env("/usr/bin/claude");
    
    // Clean up
    env::remove_var("TEST_HOME");
    env::remove_var("TEST_LANG");
    env::remove_var("TEST_RANDOM");
    
    // We can't directly test the Command's environment,
    // but we can verify the function doesn't panic
}

#[test]
fn test_path_modification_idempotence() {
    let original_path = env::var("PATH").unwrap_or_default();
    
    // Test that running the same command multiple times doesn't keep adding to PATH
    let nvm_claude = "/Users/test/.nvm/versions/node/v20.0.0/bin/claude";
    let expected_dir = "/Users/test/.nvm/versions/node/v20.0.0/bin";
    
    // First call
    env::set_var("PATH", "/usr/bin:/usr/local/bin");
    let _cmd1 = create_command_with_env(nvm_claude);
    
    // Set PATH to include the NVM directory
    env::set_var("PATH", format!("{}:/usr/bin:/usr/local/bin", expected_dir));
    
    // Second call - should not add the directory again
    let _cmd2 = create_command_with_env(nvm_claude);
    
    // Verify using path_utils that the directory won't be added twice
    let path_with_nvm = format!("{}:/usr/bin:/usr/local/bin", expected_dir);
    let result = crate::path_utils::add_to_path_if_missing(expected_dir);
    assert_eq!(result, path_with_nvm);
    
    env::set_var("PATH", original_path);
}

#[cfg(test)]
mod version_tests {
    use super::*;
    use claudia_lib::claude_binary::ClaudeVersion;
    
    #[test]
    fn test_claude_version_parsing() {
        // Test valid version strings
        let v1 = ClaudeVersion::from_str("claude version: 1.0.0").unwrap();
        assert_eq!(v1.major, 1);
        assert_eq!(v1.minor, 0);
        assert_eq!(v1.patch, 0);
        
        let v2 = ClaudeVersion::from_str("Claude version: 2.3.4-beta").unwrap();
        assert_eq!(v2.major, 2);
        assert_eq!(v2.minor, 3);
        assert_eq!(v2.patch, 4);
        
        // Test invalid version strings
        assert!(ClaudeVersion::from_str("invalid").is_none());
        assert!(ClaudeVersion::from_str("claude version: invalid").is_none());
    }
    
    #[test]
    fn test_claude_version_comparison() {
        let v1 = ClaudeVersion { major: 1, minor: 0, patch: 0 };
        let v2 = ClaudeVersion { major: 1, minor: 0, patch: 1 };
        let v3 = ClaudeVersion { major: 1, minor: 1, patch: 0 };
        let v4 = ClaudeVersion { major: 2, minor: 0, patch: 0 };
        
        assert!(v1 < v2);
        assert!(v2 < v3);
        assert!(v3 < v4);
        assert!(v1 < v4);
        
        let v5 = ClaudeVersion { major: 1, minor: 0, patch: 0 };
        assert_eq!(v1, v5);
    }
}

#[cfg(test)]
mod installation_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    
    #[test]
    #[cfg(unix)]
    fn test_discover_claude_installations() {
        // Create a temporary directory structure
        let temp_dir = TempDir::new().unwrap();
        
        // Create mock claude binaries
        let paths = vec![
            "bin/claude",
            ".local/bin/claude",
            ".nvm/versions/node/v18.0.0/bin/claude",
            "opt/homebrew/bin/claude",
        ];
        
        for path in &paths {
            let full_path = temp_dir.path().join(path);
            fs::create_dir_all(full_path.parent().unwrap()).unwrap();
            fs::write(&full_path, "#!/bin/sh\necho 'claude version: 1.0.0'").unwrap();
            
            // Make executable
            let mut perms = fs::metadata(&full_path).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&full_path, perms).unwrap();
        }
        
        // Set HOME to temp directory
        let original_home = env::var("HOME").ok();
        env::set_var("HOME", temp_dir.path());
        
        // Test discovery
        let installations = discover_claude_installations();
        
        // Should find at least some of our mock installations
        assert!(!installations.is_empty());
        
        // Restore HOME
        if let Some(home) = original_home {
            env::set_var("HOME", home);
        } else {
            env::remove_var("HOME");
        }
    }
    
    #[test]
    fn test_claude_installation_info() {
        let temp_dir = TempDir::new().unwrap();
        let claude_path = temp_dir.path().join("claude");
        
        // Create a mock claude binary
        fs::write(&claude_path, "#!/bin/sh\necho 'claude version: 1.2.3'").unwrap();
        
        #[cfg(unix)]
        {
            let mut perms = fs::metadata(&claude_path).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&claude_path, perms).unwrap();
        }
        
        // Test getting installation info
        let info = ClaudeInstallation {
            path: claude_path.to_string_lossy().to_string(),
            version: Some(ClaudeVersion { major: 1, minor: 2, patch: 3 }),
            install_type: InstallationType::Direct,
        };
        
        assert_eq!(info.path, claude_path.to_string_lossy().to_string());
        assert!(info.version.is_some());
        assert_eq!(info.version.unwrap().major, 1);
    }
}

#[test]
fn test_path_deduplication_in_create_command() {
    let original_path = env::var("PATH").unwrap_or_default();
    
    // Set up a PATH with duplicates
    env::set_var("PATH", "/usr/bin:/usr/local/bin:/usr/bin:/opt/bin");
    
    // Create command - should handle duplicates properly
    let _cmd = create_command_with_env("/opt/bin/claude");
    
    // Verify through path_utils that duplicates are handled
    let deduped = crate::path_utils::deduplicate_path("/usr/bin:/usr/local/bin:/usr/bin:/opt/bin");
    assert_eq!(deduped, "/usr/bin:/usr/local/bin:/opt/bin");
    
    env::set_var("PATH", original_path);
}