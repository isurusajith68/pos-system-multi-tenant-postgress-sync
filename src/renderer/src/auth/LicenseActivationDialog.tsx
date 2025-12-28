// import React, { useState, useEffect } from "react";
// import toast from "react-hot-toast";

// interface LicenseActivationDialogProps {
//   onLicenseActivated: () => void;
// }

// const LicenseActivationDialog: React.FC<LicenseActivationDialogProps> = ({
//   onLicenseActivated
// }) => {
//   const [licenseKey, setLicenseKey] = useState("");
//   const [isActivating, setIsActivating] = useState(false);
//   const [licenseInfo, setLicenseInfo] = useState<{
//     isActivated: boolean;
//     hasLicenseKey: boolean;
//     licenseKeyHash?: string;
//   } | null>(null);

//   useEffect(() => {
//     checkLicenseStatus();
//   }, []);

//   const checkLicenseStatus = async () => {
//     try {
//       const info = await window.api.license.getInfo();
//       setLicenseInfo(info);
//     } catch (error) {
//       console.error("Error checking license status:", error);
//     }
//   };

//   const handleActivate = async () => {
//     if (!licenseKey.trim()) {
//       toast.error("Please enter a license key");
//       return;
//     }

//     setIsActivating(true);
//     try {
//       const result = await window.api.license.activate(licenseKey.trim());

//       if (result.success) {
//         toast.success(result.message);
//         onLicenseActivated();
//       } else {
//         toast.error(result.message);
//       }
//     } catch (error) {
//       console.error("Error activating license:", error);
//       toast.error("Failed to activate license. Please try again.");
//     } finally {
//       setIsActivating(false);
//     }
//   };

//   const handleKeyPress = (e: React.KeyboardEvent) => {
//     if (e.key === "Enter") {
//       handleActivate();
//     }
//   };

//   return (
//     <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
//       <div className="max-w-md w-full bg-white rounded-lg shadow-xl p-8">
//         {/* Header */}
//         <div className="text-center mb-8">
//           <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
//             <svg
//               className="w-8 h-8 text-blue-600"
//               fill="none"
//               stroke="currentColor"
//               viewBox="0 0 24 24"
//             >
//               <path
//                 strokeLinecap="round"
//                 strokeLinejoin="round"
//                 strokeWidth={2}
//                 d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
//               />
//             </svg>
//           </div>
//           <h1 className="text-2xl font-bold text-gray-900 mb-2">License Activation Required</h1>
//           <p className="text-gray-600">Please enter your license key to activate the POS System</p>
//         </div>

//         {/* License Key Input */}
//         <div className="mb-6">
//           <label htmlFor="licenseKey" className="block text-sm font-medium text-gray-700 mb-2">
//             License Key
//           </label>
//           <input
//             type="text"
//             id="licenseKey"
//             value={licenseKey}
//             onChange={(e) => setLicenseKey(e.target.value)}
//             onKeyPress={handleKeyPress}
//             placeholder="ZENTRA-XXXX-XXXX-XXXX"
//             className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-lg font-mono tracking-wider"
//             disabled={isActivating}
//           />
//         </div>

//         {/* Activate Button */}
//         <button
//           onClick={handleActivate}
//           disabled={isActivating || !licenseKey.trim()}
//           className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
//         >
//           {isActivating ? (
//             <div className="flex items-center justify-center">
//               <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
//               Activating...
//             </div>
//           ) : (
//             "Activate License"
//           )}
//         </button>

//         {/* License Info */}
//         {licenseInfo && (
//           <div className="mt-6 p-4 bg-gray-50 rounded-lg">
//             <h3 className="text-sm font-medium text-gray-900 mb-2">License Status</h3>
//             <div className="text-sm text-gray-600 space-y-1">
//               <div className="flex justify-between">
//                 <span>Activated:</span>
//                 <span className={licenseInfo.isActivated ? "text-green-600" : "text-red-600"}>
//                   {licenseInfo.isActivated ? "Yes" : "No"}
//                 </span>
//               </div>
//               {licenseInfo.hasLicenseKey && (
//                 <div className="flex justify-between">
//                   <span>License Key:</span>
//                   <span className="font-mono text-xs">
//                     {licenseInfo.licenseKeyHash?.substring(0, 16)}...
//                   </span>
//                 </div>
//               )}
//             </div>
//           </div>
//         )}

//         {/* Footer */}
//         <div className="mt-6 text-center">
//           <p className="text-xs text-gray-500">
//             Need a license key? Contact your system administrator.
//           </p>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default LicenseActivationDialog;
