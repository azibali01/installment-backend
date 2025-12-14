import express, { type Request, type Response } from "express";
import { authenticate, authorizePermission } from "../middleware/auth.js";
import Payment from "../models/Payment.js";
import Expense from "../models/Expense.js";
import InstallmentPlan from "../models/InstallmentPlan.js";
import User from "../models/User.js";
import { type PipelineStage } from "mongoose";
import PDFDocument from "pdfkit";

const router = express.Router();

router.get(
  "/cash-flow",
  authenticate,
  authorizePermission("view_reports"),
  async (req: Request, res: Response) => {
    try {
      const { startDate, endDate } = req.query;

      const query: any = {};
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate as string);
        if (endDate) query.createdAt.$lte = new Date(endDate as string);
      }

      const cashIn = await Payment.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const cashOut = await Expense.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const totalCashIn = cashIn[0]?.total || 0;
      const totalCashOut = cashOut[0]?.total || 0;

      res.json({
        totalCashIn,
        totalCashOut,
        profit: totalCashIn - totalCashOut,
      });
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate report",
        });
    }
  }
);

router.get(
  "/installment-status",
  authenticate,
  authorizePermission("view_reports"),
  async (req: Request, res: Response) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const overdue = await InstallmentPlan.find({
        "installmentSchedule.dueDate": { $lt: today },
        "installmentSchedule.status": "pending",
      });

      const duToday = await InstallmentPlan.find({
        "installmentSchedule.dueDate": today,
        "installmentSchedule.status": "pending",
      });

      const upcoming = await InstallmentPlan.find({
        "installmentSchedule.dueDate": { $gt: today },
        "installmentSchedule.status": "pending",
      }).limit(10);

      res.json({ overdue, duToday, upcoming });
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate report",
        });
    }
  }
);

router.get(
  "/dashboard",
  authenticate,
  authorizePermission("view_reports"),
  async (req: Request, res: Response) => {
    try {
      const windowDays = Math.max(1, Number(req.query.windowDays || 7));

      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      const upcomingEnd = new Date(startOfDay);
      upcomingEnd.setDate(upcomingEnd.getDate() + windowDays);
      upcomingEnd.setHours(23, 59, 59, 999);

      const baseUnwind: PipelineStage[] = [
        { $unwind: "$installmentSchedule" },
        {
          $addFields: {
            "installmentSchedule.remaining": {
              $subtract: [
                "$installmentSchedule.amount",
                { $ifNull: ["$installmentSchedule.paidAmount", 0] },
              ],
            },
          },
        },
        { $match: { "installmentSchedule.remaining": { $gt: 0 } } },
      ];

      const makeCountPipeline = (dateMatch: any): PipelineStage[] => [
        ...baseUnwind,
        { $match: dateMatch },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalRemaining: { $sum: "$installmentSchedule.remaining" },
          },
        },
      ];

      const makeListPipeline = (
        dateMatch: any,
        limit = 10
      ): PipelineStage[] => [
        ...baseUnwind,
        { $match: dateMatch },
        {
          $lookup: {
            from: "customers",
            localField: "customerId",
            foreignField: "_id",
            as: "customer",
          },
        },
        { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            planId: "$_id",
            installment: "$installmentSchedule",
            customer: {
              _id: "$customer._id",
              name: "$customer.name",
              phone: "$customer.phone",
            },
            productId: 1,
          },
        },
        { $sort: { "installment.dueDate": 1 } },
        { $limit: limit },
      ];

      const [
        todayAgg,
        upcomingAgg,
        overdueAgg,
        todayList,
        upcomingList,
        overdueList,
        cashInAgg,
        cashOutAgg,
      ] = await Promise.all([
        InstallmentPlan.aggregate(
          makeCountPipeline({
            "installmentSchedule.dueDate": { $gte: startOfDay, $lte: endOfDay },
          })
        ),
        InstallmentPlan.aggregate(
          makeCountPipeline({
            "installmentSchedule.dueDate": { $gt: endOfDay, $lte: upcomingEnd },
          })
        ),
        InstallmentPlan.aggregate(
          makeCountPipeline({
            "installmentSchedule.dueDate": { $lt: startOfDay },
          })
        ),
        InstallmentPlan.aggregate(
          makeListPipeline(
            {
              "installmentSchedule.dueDate": {
                $gte: startOfDay,
                $lte: endOfDay,
              },
            },
            10
          )
        ),
        InstallmentPlan.aggregate(
          makeListPipeline(
            {
              "installmentSchedule.dueDate": {
                $gt: endOfDay,
                $lte: upcomingEnd,
              },
            },
            10
          )
        ),
        InstallmentPlan.aggregate(
          makeListPipeline(
            { "installmentSchedule.dueDate": { $lt: startOfDay } },
            10
          )
        ),
        Payment.aggregate([
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        Expense.aggregate([
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
      ]);

      const normalize = (arr: any[]) =>
        arr[0]
          ? { count: arr[0].count, totalRemaining: arr[0].totalRemaining }
          : { count: 0, totalRemaining: 0 };

      const totalCashIn = cashInAgg[0]?.total || 0;
      const totalCashOut = cashOutAgg[0]?.total || 0;

      res.json({
        today: normalize(todayAgg),
        upcoming: normalize(upcomingAgg),
        overdue: normalize(overdueAgg),
        todayList,
        upcomingList,
        overdueList,
        totalCashIn,
        totalCashOut,
      });
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate dashboard",
        });
    }
  }
);

router.get(
  "/download-pdf",
  authenticate,
  authorizePermission("view_reports"),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Get user's cash balance
      const user = await User.findById(userId).select("name email cashBalance");
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get all remaining installments (plans with pending installments)
      const allPlans = await InstallmentPlan.find({
        status: { $in: ["approved", "pending"] },
      })
        .populate("customerId", "name phone customerId")
        .populate("productId", "name price")
        .lean();

      // Filter plans that have remaining installments
      const plansWithRemaining = allPlans.filter((plan: any) => {
        if (!plan.installmentSchedule || !Array.isArray(plan.installmentSchedule)) {
          return false;
        }
        return plan.installmentSchedule.some(
          (schedule: any) =>
            schedule.status === "pending" &&
            (schedule.paidAmount || 0) < (schedule.amount || 0)
        );
      });

      // Calculate remaining amounts for each plan
      const remainingInstallments = plansWithRemaining.map((plan: any) => {
        const remainingSchedule = (plan.installmentSchedule || []).filter(
          (schedule: any) =>
            schedule.status === "pending" &&
            (schedule.paidAmount || 0) < (schedule.amount || 0)
        );

        const totalRemaining = remainingSchedule.reduce(
          (sum: number, schedule: any) => {
            const remaining = (schedule.amount || 0) - (schedule.paidAmount || 0);
            return sum + remaining;
          },
          0
        );

        return {
          installmentId: plan.installmentId || plan._id.toString().slice(-6),
          customerName:
            typeof plan.customerId === "object"
              ? plan.customerId?.name || "N/A"
              : "N/A",
          customerPhone:
            typeof plan.customerId === "object"
              ? plan.customerId?.phone || "N/A"
              : "N/A",
          productName:
            typeof plan.productId === "object"
              ? plan.productId?.name || "N/A"
              : "N/A",
          totalRemaining,
          remainingCount: remainingSchedule.length,
          nextDueDate:
            remainingSchedule.length > 0
              ? remainingSchedule[0].dueDate
              : null,
        };
      });

      // Get all expenses
      const expenses = await Expense.find()
        .populate("userId", "name")
        .populate("relatedUser", "name")
        .sort({ date: -1 })
        .lean();

      // Calculate total expenses
      const totalExpenses = expenses.reduce(
        (sum: number, exp: any) => sum + (exp.amount || 0),
        0
      );

      // Create PDF with better margins
      const doc = new PDFDocument({ 
        margin: 50,
        size: 'A4',
        info: {
          Title: 'Installment Management Report',
          Author: user.name,
          Subject: 'Financial Report',
          Creator: 'Installment Management System'
        }
      });
      const filename = `report-${new Date().toISOString().split("T")[0]}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );

      doc.pipe(res);

      // Color definitions (RGB format for PDFKit)
      const primaryColor = '#2563eb'; // Blue
      const successColor = '#10b981'; // Green
      const warningColor = '#f59e0b'; // Orange
      const dangerColor = '#ef4444'; // Red
      const darkGray = '#1f2937';
      const lightGray = '#f3f4f6';
      const borderGray = '#e5e7eb';

      // Helper function to convert hex to RGB
      const hexToRgb = (hex: string): [number, number, number] => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
          ? [
              parseInt(result[1], 16) / 255,
              parseInt(result[2], 16) / 255,
              parseInt(result[3], 16) / 255,
            ]
          : [0, 0, 0];
      };

      // Helper function to draw colored box
      const drawColoredBox = (x: number, y: number, width: number, height: number, hexColor: string) => {
        const [r, g, b] = hexToRgb(hexColor);
        doc.rect(x, y, width, height).fillColor([r, g, b]).fill();
      };

      // Helper function to draw rounded rectangle
      const drawRoundedRect = (x: number, y: number, width: number, height: number, radius: number, hexColor: string) => {
        const [r, g, b] = hexToRgb(hexColor);
        doc.roundedRect(x, y, width, height, radius).fillColor([r, g, b]).fill();
      };

      // Header with colored background
      const headerHeight = 80;
      drawColoredBox(0, 0, doc.page.width, headerHeight, primaryColor);
      
      const [whiteR, whiteG, whiteB] = hexToRgb('#ffffff');
      doc.fillColor([whiteR, whiteG, whiteB])
         .fontSize(24)
         .font('Helvetica-Bold')
         .text("Installment Management Report", 50, 30, { align: "center", width: doc.page.width - 100 });
      
      doc.fontSize(11)
         .font('Helvetica')
         .text(`Generated on: ${new Date().toLocaleString()}`, 50, 60, { align: "center", width: doc.page.width - 100 });
      
      doc.fillColor([0, 0, 0]); // Reset to black
      let yPos = headerHeight + 30;

      // User Cash Balance Section with colored box
      const cashBoxHeight = 90;
      const cashBoxY = yPos;
      
      // Draw light green background box
      drawRoundedRect(50, cashBoxY, doc.page.width - 100, cashBoxHeight, 8, '#ecfdf5');
      
      // Border
      const [successR, successG, successB] = hexToRgb(successColor);
      doc.save();
      doc.roundedRect(50, cashBoxY, doc.page.width - 100, cashBoxHeight, 8)
         .lineWidth(2)
         .strokeColor([successR, successG, successB])
         .stroke();
      doc.restore();
      
      const [darkGrayR, darkGrayG, darkGrayB] = hexToRgb(darkGray);
      doc.fillColor([darkGrayR, darkGrayG, darkGrayB])
         .fontSize(18)
         .font('Helvetica-Bold')
         .text("Cash in Hand", 70, cashBoxY + 15);
      
      const [grayR, grayG, grayB] = hexToRgb('#374151');
      doc.fontSize(12)
         .font('Helvetica')
         .fillColor([grayR, grayG, grayB])
         .text(`User: ${user.name}`, 70, cashBoxY + 40, { width: 200 });
      doc.text(`Email: ${user.email}`, 70, cashBoxY + 55, { width: 200 });
      
      doc.fontSize(16)
         .font('Helvetica-Bold')
         .fillColor([successR, successG, successB])
         .text(
           `Cash Balance: PKR ${user.cashBalance?.toLocaleString() || "0.00"}`,
           300,
           cashBoxY + 40,
           { width: 200 }
         );
      
      doc.fillColor([0, 0, 0]); // Reset
      yPos = cashBoxY + cashBoxHeight + 25;

      // Remaining Installments Section
      const [primaryR, primaryG, primaryB] = hexToRgb(primaryColor);
      doc.fillColor([primaryR, primaryG, primaryB])
         .fontSize(18)
         .font('Helvetica-Bold')
         .text("Remaining Installments", 50, yPos);
      
      yPos += 25;

      if (remainingInstallments.length === 0) {
        doc.fillColor([grayR, grayG, grayB])
           .fontSize(12)
           .font('Helvetica')
           .text("No remaining installments found.", 70, yPos);
        yPos += 30;
      } else {
        const totalRemaining = remainingInstallments.reduce(
          (sum, plan) => sum + plan.totalRemaining,
          0
        );

        // Summary box
        const summaryBoxY = yPos;
        const summaryBoxHeight = 50;
        drawRoundedRect(50, summaryBoxY, doc.page.width - 100, summaryBoxHeight, 8, '#eff6ff');
        doc.roundedRect(50, summaryBoxY, doc.page.width - 100, summaryBoxHeight, 8)
           .lineWidth(1.5)
           .strokeColor([primaryR, primaryG, primaryB])
           .stroke();

        doc.fillColor([darkGrayR, darkGrayG, darkGrayB])
           .fontSize(12)
           .font('Helvetica-Bold')
           .text(`Total Plans: ${remainingInstallments.length}`, 70, summaryBoxY + 10);
        
        doc.fillColor([primaryR, primaryG, primaryB])
           .fontSize(14)
           .font('Helvetica-Bold')
           .text(
             `Total Remaining: PKR ${totalRemaining.toLocaleString()}`,
             300,
             summaryBoxY + 8,
             { width: 200 }
           );

        yPos = summaryBoxY + summaryBoxHeight + 20;

        // Table header with colored background
        const tableHeaderY = yPos;
        const headerHeight = 25;
        drawRoundedRect(50, tableHeaderY, doc.page.width - 100, headerHeight, 4, primaryColor);
        
        doc.fillColor([whiteR, whiteG, whiteB])
           .fontSize(10)
           .font('Helvetica-Bold')
           .text("ID", 60, tableHeaderY + 7);
        doc.text("Customer", 120, tableHeaderY + 7);
        doc.text("Product", 250, tableHeaderY + 7);
        doc.text("Remaining", 350, tableHeaderY + 7);
        doc.text("Count", 450, tableHeaderY + 7);
        doc.text("Next Due", 500, tableHeaderY + 7);

        yPos = tableHeaderY + headerHeight + 5;
        doc.fillColor([0, 0, 0]); // Reset to black

        // Table rows with alternating colors
        remainingInstallments.forEach((plan, index) => {
          if (yPos > 700) {
            // New page if needed
            doc.addPage();
            yPos = 50;
            // Redraw header on new page
            const newHeaderY = yPos;
            drawRoundedRect(50, newHeaderY, doc.page.width - 100, headerHeight, 4, primaryColor);
            doc.fillColor([whiteR, whiteG, whiteB])
               .fontSize(10)
               .font('Helvetica-Bold')
               .text("ID", 60, newHeaderY + 7);
            doc.text("Customer", 120, newHeaderY + 7);
            doc.text("Product", 250, newHeaderY + 7);
            doc.text("Remaining", 350, newHeaderY + 7);
            doc.text("Count", 450, newHeaderY + 7);
            doc.text("Next Due", 500, newHeaderY + 7);
            yPos = newHeaderY + headerHeight + 5;
            doc.fillColor([0, 0, 0]);
          }

          // Alternate row colors
          if (index % 2 === 0) {
            const [lightGrayR, lightGrayG, lightGrayB] = hexToRgb(lightGray);
            doc.rect(50, yPos - 5, doc.page.width - 100, 18)
               .fillColor([lightGrayR, lightGrayG, lightGrayB])
               .fill();
          }

          doc.fillColor([0, 0, 0])
             .fontSize(9)
             .font('Helvetica')
             .text(plan.installmentId || "N/A", 60, yPos);
          
          doc.text(plan.customerName.substring(0, 18), 120, yPos, {
            width: 130,
            ellipsis: true,
          });
          
          doc.text(plan.productName.substring(0, 18), 250, yPos, {
            width: 100,
            ellipsis: true,
          });
          
          const [warningR, warningG, warningB] = hexToRgb(warningColor);
          doc.fillColor([warningR, warningG, warningB])
             .font('Helvetica-Bold')
             .text(`PKR ${plan.totalRemaining.toLocaleString()}`, 350, yPos);
          
          doc.fillColor([0, 0, 0])
             .font('Helvetica')
             .text(String(plan.remainingCount), 450, yPos);
          
          if (plan.nextDueDate) {
            const dueDate = new Date(plan.nextDueDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            dueDate.setHours(0, 0, 0, 0);
            
            if (dueDate < today) {
              const [dangerR, dangerG, dangerB] = hexToRgb(dangerColor);
              doc.fillColor([dangerR, dangerG, dangerB]); // Red for overdue
            } else {
              doc.fillColor([grayR, grayG, grayB]); // Gray for future dates
            }
            
            doc.text(dueDate.toLocaleDateString(), 500, yPos);
          } else {
            doc.fillColor([grayR, grayG, grayB])
               .text("N/A", 500, yPos);
          }

          yPos += 18;
        });

        // Table bottom border
        doc.moveTo(50, yPos - 5)
           .lineTo(doc.page.width - 50, yPos - 5)
           .lineWidth(1)
           .strokeColor(borderGray)
           .stroke();
        
        yPos += 15;
      }

      // Expenses Section
      const [dangerR, dangerG, dangerB] = hexToRgb(dangerColor);
      doc.fillColor([dangerR, dangerG, dangerB])
         .fontSize(18)
         .font('Helvetica-Bold')
         .text("Expenses", 50, yPos);
      
      yPos += 25;

      // Summary box for expenses
      const expenseSummaryY = yPos;
      const expenseSummaryHeight = 50;
      drawRoundedRect(50, expenseSummaryY, doc.page.width - 100, expenseSummaryHeight, 8, '#fef2f2');
      doc.roundedRect(50, expenseSummaryY, doc.page.width - 100, expenseSummaryHeight, 8)
         .lineWidth(1.5)
         .strokeColor([dangerR, dangerG, dangerB])
         .stroke();

      doc.fillColor([darkGrayR, darkGrayG, darkGrayB])
         .fontSize(12)
         .font('Helvetica-Bold')
         .text(`Total Expense Records: ${expenses.length}`, 70, expenseSummaryY + 10);
      
      doc.fillColor([dangerR, dangerG, dangerB])
         .fontSize(14)
         .font('Helvetica-Bold')
         .text(
           `Total Expenses: PKR ${totalExpenses.toLocaleString()}`,
           300,
           expenseSummaryY + 8,
           { width: 200 }
         );

      yPos = expenseSummaryY + expenseSummaryHeight + 20;

      if (expenses.length > 0) {
        // Expense table header with colored background
        const expenseHeaderY = yPos;
        const expenseHeaderHeight = 25;
        drawRoundedRect(50, expenseHeaderY, doc.page.width - 100, expenseHeaderHeight, 4, dangerColor);
        
        doc.fillColor([whiteR, whiteG, whiteB])
           .fontSize(10)
           .font('Helvetica-Bold')
           .text("Date", 60, expenseHeaderY + 7);
        doc.text("Category", 120, expenseHeaderY + 7);
        doc.text("Amount", 250, expenseHeaderY + 7);
        doc.text("Description", 320, expenseHeaderY + 7);
        doc.text("User", 450, expenseHeaderY + 7);

        yPos = expenseHeaderY + expenseHeaderHeight + 5;
        doc.fillColor([0, 0, 0]); // Reset to black

        // Show last 50 expenses to avoid PDF being too large
        const expensesToShow = expenses.slice(0, 50);
        expensesToShow.forEach((exp: any, index: number) => {
          if (yPos > 700) {
            doc.addPage();
            yPos = 50;
            // Redraw header on new page
            const newExpenseHeaderY = yPos;
            drawRoundedRect(50, newExpenseHeaderY, doc.page.width - 100, expenseHeaderHeight, 4, dangerColor);
            doc.fillColor([whiteR, whiteG, whiteB])
               .fontSize(10)
               .font('Helvetica-Bold')
               .text("Date", 60, newExpenseHeaderY + 7);
            doc.text("Category", 120, newExpenseHeaderY + 7);
            doc.text("Amount", 250, newExpenseHeaderY + 7);
            doc.text("Description", 320, newExpenseHeaderY + 7);
            doc.text("User", 450, newExpenseHeaderY + 7);
            yPos = newExpenseHeaderY + expenseHeaderHeight + 5;
            doc.fillColor([0, 0, 0]);
          }

          // Alternate row colors
          if (index % 2 === 0) {
            const [lightGrayR, lightGrayG, lightGrayB] = hexToRgb(lightGray);
            doc.rect(50, yPos - 5, doc.page.width - 100, 18)
               .fillColor([lightGrayR, lightGrayG, lightGrayB])
               .fill();
          }

          doc.fillColor([0, 0, 0])
             .fontSize(9)
             .font('Helvetica')
             .text(
               new Date(exp.date).toLocaleDateString(),
               60,
               yPos
             );
          
          // Category with color coding
          const categoryColors: Record<string, string> = {
            salary: '#3b82f6',
            rent: '#8b5cf6',
            utilities: '#06b6d4',
            inventory_purchase: '#10b981',
            supplies: '#f59e0b',
            marketing: '#ec4899',
            maintenance: '#ef4444',
            logistics: '#6366f1',
            taxes: '#f97316',
            other: '#6b7280'
          };
          
          const categoryColor = categoryColors[exp.category] || '#6b7280';
          const [catR, catG, catB] = hexToRgb(categoryColor);
          doc.fillColor([catR, catG, catB])
             .font('Helvetica-Bold')
             .text((exp.category || "N/A").replace('_', ' ').toUpperCase(), 120, yPos, { width: 130 });
          
          doc.fillColor([dangerR, dangerG, dangerB])
             .font('Helvetica-Bold')
             .text(`PKR ${(exp.amount || 0).toLocaleString()}`, 250, yPos);
          
          doc.fillColor([0, 0, 0])
             .font('Helvetica')
             .text((exp.description || "N/A").substring(0, 28), 320, yPos, {
               width: 130,
               ellipsis: true,
             });
          
          const userName =
            typeof exp.userId === "object" ? exp.userId?.name || "N/A" : "N/A";
          doc.text(userName.substring(0, 18), 450, yPos, {
            width: 100,
            ellipsis: true,
          });

          yPos += 18;
        });

        // Table bottom border
        doc.moveTo(50, yPos - 5)
           .lineTo(doc.page.width - 50, yPos - 5)
           .lineWidth(1)
           .strokeColor([borderGrayR, borderGrayG, borderGrayB])
           .stroke();

        if (expenses.length > 50) {
          yPos += 10;
          doc.fillColor([grayR, grayG, grayB])
             .fontSize(9)
             .font('Helvetica-Oblique')
             .text(
               `... and ${expenses.length - 50} more expense records`,
               70,
               yPos
             );
        }
      }

      // Footer with colored background
      const footerY = doc.page.height - 40;
      const [lightGrayR, lightGrayG, lightGrayB] = hexToRgb(lightGray);
      doc.rect(0, footerY, doc.page.width, 40)
         .fillColor([lightGrayR, lightGrayG, lightGrayB])
         .fill();
      
      doc.fillColor([grayR, grayG, grayB])
         .fontSize(9)
         .font('Helvetica')
         .text(
           `Report generated by ${user.name} on ${new Date().toLocaleString()}`,
           50,
           footerY + 15,
           { align: "center", width: doc.page.width - 100 }
         );
      
      doc.fillColor([primaryR, primaryG, primaryB])
         .fontSize(8)
         .text(
           "Installment Management System",
           50,
           footerY + 30,
           { align: "center", width: doc.page.width - 100 }
         );

      doc.end();
    } catch (error) {
      console.error("PDF generation error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate PDF report",
      });
    }
  }
);

export default router;
