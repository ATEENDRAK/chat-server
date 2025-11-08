package logger

import (
	"log"
	"os"
)

var (
	InfoLogger    *log.Logger
	WarningLogger *log.Logger
	ErrorLogger   *log.Logger
)

func init() {
	InfoLogger = log.New(os.Stdout, "INFO: ", log.Ldate|log.Ltime|log.Lshortfile)
	WarningLogger = log.New(os.Stdout, "WARNING: ", log.Ldate|log.Ltime|log.Lshortfile)
	ErrorLogger = log.New(os.Stderr, "ERROR: ", log.Ldate|log.Ltime|log.Lshortfile)
}

// Info logs info messages
func Info(v ...interface{}) {
	InfoLogger.Println(v...)
}

// Warning logs warning messages
func Warning(v ...interface{}) {
	WarningLogger.Println(v...)
}

// Error logs error messages
func Error(v ...interface{}) {
	ErrorLogger.Println(v...)
}

// Infof logs formatted info messages
func Infof(format string, v ...interface{}) {
	InfoLogger.Printf(format, v...)
}

// Warningf logs formatted warning messages
func Warningf(format string, v ...interface{}) {
	WarningLogger.Printf(format, v...)
}

// Errorf logs formatted error messages
func Errorf(format string, v ...interface{}) {
	ErrorLogger.Printf(format, v...)
}

