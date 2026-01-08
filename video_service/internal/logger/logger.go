package logger

import "log"

func Info(msg string)                        { log.Printf("[video-service] INFO: %s", msg) }
func Error(msg string)                       { log.Printf("[video-service] ERROR: %s", msg) }
func Errorf(fmtStr string, v ...interface{}) { log.Printf("[video-service] ERROR: "+fmtStr, v...) }
func Infof(fmtStr string, v ...interface{})  { log.Printf("[video-service] INFO: "+fmtStr, v...) }
