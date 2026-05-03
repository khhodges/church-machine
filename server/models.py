from sqlalchemy import Column, Integer, String, Text, DateTime, Float, func


BOARD_TYPES = {
    0x01: "TN20K-IoT",
    0x02: "TN20K-Full",
    0x03: "Ti60-Full",
    0x05: "Zynq XC7Z010 (QMTECH ZYJZGW)",
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
        timestamp = Column(Float, default=0.0)

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

    return Project, TutorialProgress, Device, FaultEvent, LaunchTest
