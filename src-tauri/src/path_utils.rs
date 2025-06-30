use std::collections::HashSet;
use std::env;
use std::path::Path;

/// Adds a directory to PATH if it doesn't already exist
/// Returns the new PATH value
pub fn add_to_path_if_missing(dir: &str) -> String {
    let current_path = env::var("PATH").unwrap_or_default();
    
    // Check if the directory already exists in PATH
    if path_contains_dir(&current_path, dir) {
        log::debug!("Directory {} already in PATH, skipping", dir);
        return current_path;
    }
    
    // Add the directory to PATH
    let new_path = if current_path.is_empty() {
        dir.to_string()
    } else {
        format!("{}:{}", dir, current_path)
    };
    
    log::info!("Added {} to PATH", dir);
    new_path
}

/// Checks if a PATH string contains a specific directory
fn path_contains_dir(path: &str, dir: &str) -> bool {
    let normalized_dir = normalize_path(dir);
    
    path.split(':')
        .map(normalize_path)
        .any(|p| p == normalized_dir)
}

/// Normalizes a path for comparison (removes trailing slashes, resolves symlinks if possible)
fn normalize_path(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    
    // Try to canonicalize the path if it exists
    if let Ok(canonical) = Path::new(trimmed).canonicalize() {
        canonical.to_string_lossy().into_owned()
    } else {
        trimmed.to_string()
    }
}

/// Deduplicates entries in a PATH string
pub fn deduplicate_path(path: &str) -> String {
    let mut seen = HashSet::new();
    let mut unique_paths = Vec::new();
    
    for p in path.split(':') {
        let normalized = normalize_path(p);
        if !normalized.is_empty() && seen.insert(normalized.clone()) {
            unique_paths.push(p.to_string());
        }
    }
    
    unique_paths.join(":")
}

/// Enhances PATH with common directories if they exist and aren't already present
pub fn enhance_path_for_common_locations(paths: &[&str]) -> Option<String> {
    let current_path = env::var("PATH").unwrap_or_default();
    let mut new_paths = Vec::new();
    
    for path in paths {
        if Path::new(path).exists() && !path_contains_dir(&current_path, path) {
            new_paths.push(path.to_string());
        }
    }
    
    if new_paths.is_empty() {
        return None;
    }
    
    // Combine new paths with existing PATH
    new_paths.push(current_path);
    let enhanced_path = new_paths.join(":");
    
    // Deduplicate the final PATH
    Some(deduplicate_path(&enhanced_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;
    
    #[test]
    fn test_path_contains_dir() {
        assert!(path_contains_dir("/usr/bin:/usr/local/bin", "/usr/bin"));
        assert!(path_contains_dir("/usr/bin:/usr/local/bin", "/usr/local/bin"));
        assert!(!path_contains_dir("/usr/bin:/usr/local/bin", "/opt/bin"));
        
        // Test with trailing slashes
        assert!(path_contains_dir("/usr/bin/:/usr/local/bin", "/usr/bin"));
        assert!(path_contains_dir("/usr/bin:/usr/local/bin/", "/usr/local/bin"));
        
        // Test empty path
        assert!(!path_contains_dir("", "/usr/bin"));
        
        // Test single directory
        assert!(path_contains_dir("/usr/bin", "/usr/bin"));
    }
    
    #[test]
    fn test_normalize_path() {
        // Test trailing slash removal
        assert_eq!(normalize_path("/usr/bin/"), "/usr/bin");
        assert_eq!(normalize_path("/usr/bin"), "/usr/bin");
        
        // Test empty path
        assert_eq!(normalize_path(""), "");
        
        // Test path with multiple trailing slashes
        assert_eq!(normalize_path("/usr/bin///"), "/usr/bin");
    }
    
    #[test]
    fn test_deduplicate_path() {
        // Basic deduplication
        let path = "/usr/bin:/usr/local/bin:/usr/bin:/opt/bin";
        let deduped = deduplicate_path(path);
        assert_eq!(deduped, "/usr/bin:/usr/local/bin:/opt/bin");
        
        // Empty path
        assert_eq!(deduplicate_path(""), "");
        
        // Single directory
        assert_eq!(deduplicate_path("/usr/bin"), "/usr/bin");
        
        // All duplicates
        assert_eq!(deduplicate_path("/usr/bin:/usr/bin:/usr/bin"), "/usr/bin");
        
        // With trailing slashes
        let path = "/usr/bin:/usr/bin/:/opt/bin";
        let deduped = deduplicate_path(path);
        assert_eq!(deduped, "/usr/bin:/opt/bin");
        
        // Empty entries
        let path = "/usr/bin::/opt/bin::";
        let deduped = deduplicate_path(path);
        assert_eq!(deduped, "/usr/bin:/opt/bin");
    }
    
    #[test]
    fn test_add_to_path_if_missing() {
        // Test with existing PATH
        env::set_var("PATH", "/usr/bin:/usr/local/bin");
        
        // Should not add duplicate
        let result = add_to_path_if_missing("/usr/bin");
        assert_eq!(result, "/usr/bin:/usr/local/bin");
        
        // Should add new directory
        let result = add_to_path_if_missing("/opt/bin");
        assert_eq!(result, "/opt/bin:/usr/bin:/usr/local/bin");
        
        // Test with empty PATH
        env::remove_var("PATH");
        let result = add_to_path_if_missing("/new/bin");
        assert_eq!(result, "/new/bin");
        
        // Test with trailing slash
        env::set_var("PATH", "/usr/bin/:/usr/local/bin");
        let result = add_to_path_if_missing("/usr/bin");
        assert_eq!(result, "/usr/bin/:/usr/local/bin");
    }
    
    #[test]
    fn test_enhance_path_for_common_locations() {
        // Create temp directories for testing
        let temp_dir = TempDir::new().unwrap();
        let test_dir1 = temp_dir.path().join("test1");
        let test_dir2 = temp_dir.path().join("test2");
        let test_dir3 = temp_dir.path().join("test3");
        
        fs::create_dir(&test_dir1).unwrap();
        fs::create_dir(&test_dir2).unwrap();
        
        let test_paths = vec![
            test_dir1.to_str().unwrap(),
            test_dir2.to_str().unwrap(),
            test_dir3.to_str().unwrap(), // Doesn't exist
        ];
        
        // Test with empty PATH
        env::remove_var("PATH");
        let result = enhance_path_for_common_locations(&test_paths);
        assert!(result.is_some());
        let enhanced = result.unwrap();
        assert!(enhanced.contains(test_dir1.to_str().unwrap()));
        assert!(enhanced.contains(test_dir2.to_str().unwrap()));
        assert!(!enhanced.contains(test_dir3.to_str().unwrap()));
        
        // Test with existing PATH
        env::set_var("PATH", format!("{}:/usr/bin", test_dir1.to_str().unwrap()));
        let result = enhance_path_for_common_locations(&test_paths);
        assert!(result.is_some());
        let enhanced = result.unwrap();
        assert!(enhanced.starts_with(test_dir2.to_str().unwrap()));
        
        // Test when all paths already exist in PATH
        env::set_var("PATH", format!("{}:{}", 
            test_dir1.to_str().unwrap(), 
            test_dir2.to_str().unwrap()
        ));
        let result = enhance_path_for_common_locations(&test_paths);
        assert!(result.is_none());
        
        // Test with non-existent paths only
        let non_existent = vec!["/this/does/not/exist", "/neither/does/this"];
        let result = enhance_path_for_common_locations(&non_existent);
        assert!(result.is_none());
    }
    
    #[test]
    fn test_path_deduplication_with_symlinks() {
        // This test would require creating symlinks which might not work on all platforms
        // For now, we'll test the normalization function with regular paths
        let temp_dir = TempDir::new().unwrap();
        let real_dir = temp_dir.path().join("real");
        fs::create_dir(&real_dir).unwrap();
        
        // Test that canonicalization works for existing paths
        let normalized = normalize_path(real_dir.to_str().unwrap());
        assert!(normalized.contains("real"));
    }
}