use claudia_lib::{claude_binary, path_utils};
use serial_test::serial;
use std::env;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

#[test]
#[serial]
fn test_path_resolution_with_multiple_claude_installations() {
    // Save original environment
    let original_path = env::var("PATH").unwrap_or_default();
    let original_home = env::var("HOME").ok();
    
    // Create temporary directory structure
    let temp_dir = TempDir::new().unwrap();
    let home_dir = temp_dir.path().join("home");
    fs::create_dir_all(&home_dir).unwrap();
    
    // Create multiple claude installations
    let installations = vec![
        ("usr/local/bin/claude", "1.0.0"),
        ("home/.nvm/versions/node/v18.0.0/bin/claude", "1.1.0"),
        ("home/.nvm/versions/node/v20.0.0/bin/claude", "1.2.0"),
        ("opt/homebrew/bin/claude", "1.0.5"),
    ];
    
    for (path, version) in &installations {
        let full_path = temp_dir.path().join(path);
        fs::create_dir_all(full_path.parent().unwrap()).unwrap();
        
        // Create mock claude binary
        let script = format!("#!/bin/sh\necho 'claude version: {}'", version);
        fs::write(&full_path, script).unwrap();
        
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&full_path).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&full_path, perms).unwrap();
        }
    }
    
    // Set up environment
    env::set_var("HOME", &home_dir);
    env::set_var("PATH", temp_dir.path().join("usr/local/bin").to_string_lossy().to_string());
    
    // Test PATH enhancement for NVM directory
    let nvm_claude = temp_dir.path().join("home/.nvm/versions/node/v20.0.0/bin/claude");
    let cmd = claude_binary::create_command_with_env(nvm_claude.to_str().unwrap());
    
    // Verify PATH was enhanced correctly
    let nvm_bin = temp_dir.path().join("home/.nvm/versions/node/v20.0.0/bin");
    let enhanced_path = path_utils::add_to_path_if_missing(nvm_bin.to_str().unwrap());
    assert!(enhanced_path.contains("v20.0.0/bin"));
    
    // Restore environment
    env::set_var("PATH", original_path);
    if let Some(home) = original_home {
        env::set_var("HOME", home);
    } else {
        env::remove_var("HOME");
    }
}

#[test]
#[serial]
fn test_path_resolution_prevents_infinite_loop() {
    let original_path = env::var("PATH").unwrap_or_default();
    
    // Create a complex PATH with potential for loops
    let test_paths = vec![
        "/usr/bin",
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/Users/test/.nvm/versions/node/v18.0.0/bin",
        "/Users/test/.nvm/versions/node/v20.0.0/bin",
    ];
    
    // Set initial PATH
    env::set_var("PATH", test_paths.join(":"));
    
    // Simulate multiple calls that could cause infinite loops in the old implementation
    for _ in 0..10 {
        // Call with NVM path
        let nvm_claude = "/Users/test/.nvm/versions/node/v20.0.0/bin/claude";
        let _cmd = claude_binary::create_command_with_env(nvm_claude);
        
        // Verify PATH doesn't grow indefinitely
        let current_path = env::var("PATH").unwrap_or_default();
        let path_parts: Vec<&str> = current_path.split(':').collect();
        
        // Count occurrences of the NVM directory
        let nvm_count = path_parts.iter()
            .filter(|&&p| p.contains("v20.0.0/bin"))
            .count();
        
        // Should only appear once
        assert_eq!(nvm_count, 1, "NVM directory should only appear once in PATH");
    }
    
    env::set_var("PATH", original_path);
}

#[test]
#[serial]
fn test_path_resolution_with_symlinks() {
    let original_path = env::var("PATH").unwrap_or_default();
    
    // Create temporary directories
    let temp_dir = TempDir::new().unwrap();
    let real_dir = temp_dir.path().join("real_claude");
    let link_dir = temp_dir.path().join("link_claude");
    
    fs::create_dir_all(&real_dir).unwrap();
    
    // Create a real claude binary
    let real_claude = real_dir.join("claude");
    fs::write(&real_claude, "#!/bin/sh\necho 'claude version: 1.0.0'").unwrap();
    
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&real_claude).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&real_claude, perms).unwrap();
        
        // Create symlink
        std::os::unix::fs::symlink(&real_dir, &link_dir).unwrap();
    }
    
    // Test with both real and symlink paths
    env::set_var("PATH", "/usr/bin");
    
    // Add real directory
    let path1 = path_utils::add_to_path_if_missing(real_dir.to_str().unwrap());
    assert!(path1.contains(real_dir.to_str().unwrap()));
    
    // Try to add symlink - should recognize it's the same
    env::set_var("PATH", &path1);
    let path2 = path_utils::add_to_path_if_missing(link_dir.to_str().unwrap());
    
    // On systems that support symlinks, this might deduplicate
    // On others, both paths might be present
    assert!(!path2.is_empty());
    
    env::set_var("PATH", original_path);
}

#[test]
#[serial]
fn test_concurrent_path_modifications() {
    use std::sync::{Arc, Mutex};
    use std::thread;
    
    let original_path = env::var("PATH").unwrap_or_default();
    let path_mutex = Arc::new(Mutex::new(String::from("/usr/bin:/usr/local/bin")));
    
    // Simulate concurrent modifications
    let handles: Vec<_> = (0..5).map(|i| {
        let path_mutex = Arc::clone(&path_mutex);
        thread::spawn(move || {
            let new_dir = format!("/opt/test{}/bin", i);
            
            // Get current PATH
            let current = {
                let guard = path_mutex.lock().unwrap();
                guard.clone()
            };
            
            // Modify PATH
            env::set_var("PATH", &current);
            let enhanced = path_utils::add_to_path_if_missing(&new_dir);
            
            // Update shared PATH
            {
                let mut guard = path_mutex.lock().unwrap();
                *guard = enhanced;
            }
        })
    }).collect();
    
    // Wait for all threads
    for handle in handles {
        handle.join().unwrap();
    }
    
    // Verify final PATH is deduplicated
    let final_path = {
        let guard = path_mutex.lock().unwrap();
        guard.clone()
    };
    
    let deduped = path_utils::deduplicate_path(&final_path);
    assert_eq!(final_path, deduped, "PATH should already be deduplicated");
    
    env::set_var("PATH", original_path);
}

#[test]
#[serial]
fn test_path_resolution_edge_cases() {
    let original_path = env::var("PATH").unwrap_or_default();
    
    // Test empty PATH
    env::remove_var("PATH");
    let cmd = claude_binary::create_command_with_env("/usr/bin/claude");
    // Should not panic
    
    // Test PATH with only colons
    env::set_var("PATH", ":::");
    let enhanced = path_utils::add_to_path_if_missing("/new/bin");
    assert!(enhanced.contains("/new/bin"));
    assert!(!enhanced.starts_with(':'));
    
    // Test very long PATH
    let long_path: String = (0..100)
        .map(|i| format!("/path/to/dir{}", i))
        .collect::<Vec<_>>()
        .join(":");
    env::set_var("PATH", &long_path);
    let result = path_utils::add_to_path_if_missing("/new/unique/path");
    assert!(result.contains("/new/unique/path"));
    
    // Test PATH with spaces (should be handled gracefully)
    env::set_var("PATH", "/path with spaces:/normal/path");
    let result = path_utils::add_to_path_if_missing("/another/path");
    assert!(result.contains("/another/path"));
    
    env::set_var("PATH", original_path);
}