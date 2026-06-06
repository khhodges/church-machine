from sqlalchemy import Column, Integer, String, Text, DateTime, Float, Index, func


BOARD_TYPES = {
    0x01: "TN20K-IoT",
    0x03: "Ti60-Full",
    0x06: "Wukong XC7A100T (Artix-7)",
}

PROFILE_NAMES = {
    0x00: "IoT",
    0x01: "Full",
}


def register_models(db):
    class Project(db.Model):
        __tablename__ = "projects"

        id = Column(Integer, primary_key=True)
        name = Column(String(255), nullable=False)
        source_code = Column(Text, default="")
        created_at = Column(DateTime, server_default=func.now())
        updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    class TutorialProgress(db.Model):
        __tablename__ = "tutorial_progress"

        id = Column(Integer, primary_key=True)
        session_id = Column(String(255), nullable=False)
        lesson_id = Column(String(255), nullable=False)
        completed = Column(Integer, default=0)
        created_at = Column(DateTime, server_default=func.now())

    class Device(db.Model):
        __tablename__ = "devices"

        id = Column(Integer, primary_key=True)
        device_uid = Column(String(16), unique=True, nullable=False)
        board_type = Column(Integer, nullable=False)
        board_name = Column(String(32), default="")
        profile = Column(String(8), default="Full")
        fw_major = Column(Integer, default=1)
        fw_minor = Column(Integer, default=0)
        bridge_host = Column(String(255), default="")
        bridge_port = Column(Integer, default=0)
        bridge_scheme = Column(String(8), default="http")
        serial_port = Column(String(128), default="")
        status = Column(String(16), default="offline")
        last_seen = Column(Float, default=0.0)
        first_seen = Column(DateTime, server_default=func.now())
        boot_count = Column(Integer, default=0)
        build_sig = Column(String(8), default="00000000")
        build_verified = Column(Integer, default=0)
        boot_reason = Column(Integer, default=0)
        last_fault = Column(Integer, default=0)
        fault_nia = Column(Integer, default=0)
        label = Column(String(255), default="")
        tunnel_status = Column(String(16), default="pending")

    class FaultEvent(db.Model):
        __tablename__ = "fault_events"

        id = Column(Integer, primary_key=True)
        device_uid = Column(String(16), nullable=False)
        fault_type = Column(Integer, nullable=False, default=0)
        fault_nia = Column(Integer, nullable=False, default=0)
        boot_reason = Column(Integer, default=0)
        timestamp = Column(Float, default=0.0, index=True)
        lump_token = Column(String(16), default=None)
        lump_version = Column(Integer, default=0)
        fault_code = Column(String(32), default="")
        mnemonic = Column(String(32), default="")
        pipeline_stage = Column(String(32), default="")
        recovery_tier = Column(Integer, default=0)
        step_count = Column(Integer, default=0)
        board_name = Column(String(32), default="")
        ns_slot = Column(Integer, default=None)
        abstraction_label = Column(String(128), default="")
        nia_hex = Column(String(12), default="")
        cr12 = Column(String(32), default="")
        cr14 = Column(String(32), default="")
        cr15 = Column(String(32), default="")
        boot_count_at_fault = Column(Integer, default=0)
        raw_type = Column(String(16), default="")

    class LaunchTest(db.Model):
        __tablename__ = "launch_tests"

        id = Column(Integer, primary_key=True)
        test_id = Column(String(16), unique=True, nullable=False)
        name = Column(String(64), nullable=False)
        description = Column(Text, default="")
        status = Column(String(16), default="not-run")
        device_uid = Column(String(16), default="")
        updated_at = Column(Float, default=0.0)
        notes = Column(Text, default="")

    class CallhomeLog(db.Model):
        __tablename__ = "callhome_log"

        id = Column(Integer, primary_key=True)
        ts = Column(Float, nullable=False, default=0.0, index=True)
        uid = Column(String(16), default="")
        board = Column(String(32), default="")
        nia = Column(String(12), default="0x00000000")
        boot_ok = Column(Integer, default=1)
        fault = Column(Integer, default=0)
        fault_code = Column(Integer, default=0)
        fw_major = Column(Integer, default=1)
        fw_minor = Column(Integer, default=0)
        boot_count = Column(Integer, default=0)
        event_type = Column(String(16), default="callhome")
        cr12 = Column(String(32), default="")
        cr14 = Column(String(32), default="")
        cr15 = Column(String(32), default="")

    class UartLog(db.Model):
        __tablename__ = "uart_log"

        id = Column(Integer, primary_key=True)
        ts = Column(Float, nullable=False, default=0.0, index=True)
        uid = Column(String(16), default="")
        line = Column(Text, default="")

    return Project, TutorialProgress, Device, FaultEvent, LaunchTest, CallhomeLog, UartLog
