import { describe, it } from 'mocha';
import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';

describe('ws Package Version Tests', () => {
  it('should verify ws package version is updated to fix vulnerability', () => {
    // Read the package-lock.json file
    const packageLockPath = path.resolve(__dirname, '../package-lock.json');
    expect(fs.existsSync(packageLockPath)).to.be.true;
    
    const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
    
    // Verify ws package is at least version 8.17.1 to fix the vulnerability
    const wsPackage = findPackage(packageLock, 'ws');
    
    expect(wsPackage).to.not.be.undefined;
    expect(wsPackage).to.have.property('version');
    
    const wsVersion = wsPackage.version;
    console.log(`Found ws package version: ${wsVersion}`);
    
    // Convert version string to numbers for comparison
    const versionParts = wsVersion.split('.').map(Number);
    
    // Ensure version is at least 8.17.1
    expect(versionParts[0]).to.be.at.least(8, 'ws major version should be at least 8');
    
    if (versionParts[0] === 8) {
      expect(versionParts[1]).to.be.at.least(17, 'ws minor version should be at least 17 when major is 8');
      
      if (versionParts[1] === 17) {
        expect(versionParts[2]).to.be.at.least(1, 'ws patch version should be at least 1 when major is 8 and minor is 17');
      }
    }
  });
});

// Helper function to find a package in the package-lock.json recursive structure
function findPackage(packageLock: any, packageName: string): any {
  // Check if packages property exists (npm v7+)
  if (packageLock.packages) {
    for (const [key, value] of Object.entries(packageLock.packages)) {
      if (key.endsWith(`node_modules/${packageName}`) || key === packageName) {
        return value;
      }
    }
  }
  
  // Check dependencies (npm v6 and below)
  if (packageLock.dependencies) {
    if (packageLock.dependencies[packageName]) {
      return packageLock.dependencies[packageName];
    }
    
    // Search recursively in dependencies
    for (const depKey in packageLock.dependencies) {
      const dep = packageLock.dependencies[depKey];
      if (dep.dependencies && dep.dependencies[packageName]) {
        return dep.dependencies[packageName];
      }
    }
  }
  
  return undefined;
}