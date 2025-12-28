# 🏪 Zentra POS System

A comprehensive Point of Sale (POS) system built with **Electron**, **React**, **TypeScript**, and **SQLite**. This modern desktop application provides a complete solution for retail businesses with inventory management, sales tracking, employee management, and detailed reporting.

![Zentra POS](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![Electron](https://img.shields.io/badge/Electron-Latest-47848F)
![React](https://img.shields.io/badge/React-18+-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6)

## ✨ Features

### 🔐 **Authentication & Security**

- Secure employee login system
- Password hashing with bcrypt
- Role-based access control
- Session management

### 📦 **Product Management**

- Add, edit, and delete products
- SKU and barcode support
- Category organization
- Stock level tracking
- Price management with discount support
- Product images and descriptions

### 🏷️ **Category Management**

- Hierarchical category structure
- Parent-child category relationships
- Easy category organization
- Bulk category operations

### 👥 **Employee Management**

- Employee profiles and roles
- Secure password management
- Sales tracking per employee
- Shift logging

### 💰 **Point of Sale**

- Real-time transaction processing
- Multiple payment methods
- Receipt generation
- Customer information management
- Discount and tax calculations

### 📊 **Inventory Management**

- Real-time stock tracking
- Stock transaction history
- Low stock alerts
- Inventory adjustments
- Purchase order management

### 📈 **Sales & Reporting**

- Daily, weekly, monthly sales reports
- Employee performance tracking
- Inventory reports
- Customer insights
- Revenue analytics

### ⚙️ **Settings & Configuration**

- Company information setup
- System preferences
- Database configuration
- Backup and restore options

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v16 or higher)
- **npm** or **yarn**
- **Git**

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/isurusajith68/POS-System.git
   cd POS-System
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Setup database**

   ```bash
   npx prisma migrate dev
   npx prisma generate
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

### Default Login Credentials

- **Email**: `admin@posystem.com`
- **Password**: `admin123`

## 🛠️ Development

### **Available Scripts**

| Command               | Description                              |
| --------------------- | ---------------------------------------- |
| `npm run dev`         | Start development server with hot reload |
| `npm run build`       | Build the application for production     |
| `npm run build:win`   | Build Windows executable (.exe)          |
| `npm run build:mac`   | Build macOS application (.dmg)           |
| `npm run build:linux` | Build Linux application (AppImage, deb)  |
| `npm run typecheck`   | Run TypeScript type checking             |
| `npm run lint`        | Run ESLint code linting                  |
| `npm run format`      | Format code with Prettier                |

### **Project Structure**

```
POS-System/
├── src/
│   ├── main/           # Electron main process
│   │   ├── index.ts    # Main entry point
│   │   └── lib/        # Database & utilities
│   ├── preload/        # Preload scripts
│   ├── renderer/       # React frontend
│   │   └── src/
│   │       ├── components/  # React components
│   │       ├── contexts/    # React contexts
│   │       └── assets/      # Styles & images
│   └── generated/      # Prisma generated files
├── prisma/
│   ├── schema.prisma   # Database schema
│   ├── migrations/     # Database migrations
│   └── db/            # SQLite database file
├── build/             # Build assets
├── dist/              # Built applications
└── resources/         # Application resources
```

## 📱 Technologies Used

### **Frontend**

- **React 18** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **React Hot Toast** - Notifications

### **Backend**

- **Electron** - Desktop app framework
- **Prisma** - Database ORM
- **SQLite** - Database
- **bcrypt** - Password hashing

### **Build Tools**

- **Electron Vite** - Build tooling
- **Electron Builder** - App packaging
- **ESLint** - Code linting
- **Prettier** - Code formatting

## 📋 Database Schema

The application uses **SQLite** with **Prisma ORM** for data management:

- **Products** - Product information and inventory
- **Categories** - Product categorization
- **Employees** - User accounts and roles
- **Sales** - Transaction records
- **Customers** - Customer information
- **Inventory** - Stock tracking
- **Settings** - Application configuration

## 🔧 Configuration

### **Database Setup**

The application automatically initializes the database on first run with:

- Default admin user
- Sample categories and products
- Basic system settings

### **Environment Variables**

Create a `.env` file in the root directory:

```env
DATABASE_URL="file:./prisma/db/pos.db"
```

## 📦 Building for Production

### **Windows**

```bash
npm run build:win
```

Output: `dist/pos-1.0.0-setup.exe`

### **macOS**

```bash
npm run build:mac
```

Output: `dist/pos-1.0.0.dmg`

### **Linux**

```bash
npm run build:linux
```

Output: `dist/pos-1.0.0.AppImage`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

## 👨‍💻 Author

**isurusajith68**

- GitHub: [@isurusajith68](https://github.com/isurusajith68)

## 🙏 Acknowledgments

- Built with [Electron](https://electronjs.org/)
- UI powered by [React](https://reactjs.org/)
- Database management with [Prisma](https://prisma.io/)
- Styling with [Tailwind CSS](https://tailwindcss.com/)

---

⭐ **Star this repository if you find it helpful!**
