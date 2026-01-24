import os
import requests
import logging
import resend

logger = logging.getLogger(__name__)

def get_resend_credentials():
    """Get Resend API key and from email from Replit connector."""
    hostname = os.environ.get('REPLIT_CONNECTORS_HOSTNAME')
    if not hostname:
        logger.warning("REPLIT_CONNECTORS_HOSTNAME not set")
        return None, None
    
    repl_identity = os.environ.get('REPL_IDENTITY')
    web_repl_renewal = os.environ.get('WEB_REPL_RENEWAL')
    
    if repl_identity:
        x_replit_token = f'repl {repl_identity}'
    elif web_repl_renewal:
        x_replit_token = f'depl {web_repl_renewal}'
    else:
        logger.warning("No Replit token available for connector auth")
        return None, None
    
    try:
        response = requests.get(
            f'https://{hostname}/api/v2/connection?include_secrets=true&connector_names=resend',
            headers={
                'Accept': 'application/json',
                'X_REPLIT_TOKEN': x_replit_token
            },
            timeout=10
        )
        
        if not response.ok:
            logger.error(f"Resend connector request failed with status {response.status_code}")
            return None, None
        
        try:
            data = response.json()
        except ValueError:
            logger.error("Resend connector returned non-JSON response")
            return None, None
        
        items = data.get('items', [])
        if not items:
            logger.warning("Resend connector returned no connections - check integration setup")
            return None, None
        
        connection = items[0]
        settings = connection.get('settings', {}) if connection else {}
        
        api_key = settings.get('api_key')
        from_email = settings.get('from_email')
        
        if not api_key:
            logger.warning("Resend API key not found in connector settings")
            return None, None
        if not from_email:
            logger.warning("Resend from_email not found in connector settings")
            return None, None
            
        return api_key, from_email
    except requests.RequestException as e:
        logger.error(f"Network error fetching Resend credentials: {e}")
    except Exception as e:
        logger.error(f"Unexpected error fetching Resend credentials: {e}")
    
    return None, None

def send_welcome_email(user_email, first_name):
    """Send welcome email to newly registered user."""
    api_key, from_email = get_resend_credentials()
    
    if not api_key or not from_email:
        logger.warning("Resend not configured - skipping welcome email")
        return False
    
    resend.api_key = api_key
    
    html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }}
        h1 {{ color: #2c3e50; }}
        .highlight {{ color: #3498db; font-weight: bold; }}
        .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; }}
        a {{ color: #3498db; }}
    </style>
</head>
<body>
    <h1>Hi{' ' + first_name if first_name else ''}, Welcome to the CTMM Open Source community!</h1>
    
    <p>Thank you for exploring the Church-Turing Thesis using our Lambda Calculus Meta-Machine, developed by <a href="https://sipantic.com">SIPantic.com</a>, the blog on fail-safe cybersecurity. CTMM is the revolutionary, secure solution to traditional binary computers that share memory, allowing catastrophic breakdowns. We cannot build a surviving democratic cyber-society this way when the brands of centralised operating systems only lead to an Orwellian surveillance state and global digital dictatorships.</p>
    
    <p>You can now explore capability-based security using <span class="highlight">CLOOMC</span> (Capability-Limited/Object-Oriented/Machine-Code) built from the immutable gold of cyberspace. Golden Tokens are the keys to democracy in the Information Age, when everything is driven by software. Vulnerable computers inherited vulnerability from a shared-memory architecture created by John von Neumann in the 1940s, as the Mechanical Age of World War II ended. The decades of Cold War mentality encouraged binary computers to proliferate.</p>
    
    <p>As a member of our community, you can learn about the Lambda Calculus and the power it adds to computer science. You can also experiment with CLOOMC (Capability-Limited/Object-Oriented/Machine-Code) and save your own private simulations. We invite you to collaborate with us, join the discussion, and help expand our open-source community as we work to democratise cyberspace.</p>
    
    <p>Your account is ready for use. You can log in anytime to access the simulator, the tutorials, your saved status, and the expanding consensus. If you would like to get started, you can visit your Dashboard to run decentralised software examples and try the CLOOMC Assembly Editor.</p>
    
    <p>We look forward to your feedback and individual contributions.</p>
    
    <div class="footer">
        <p>Best regards,</p>
        <p><strong>Ken Hamer-Hodges</strong><br>
        The CTMM Simulator Team</p>
    </div>
</body>
</html>
"""
    
    try:
        params = {
            "from": from_email,
            "to": [user_email],
            "subject": "Welcome to the CTMM Open Source Community!",
            "html": html_content,
        }
        
        email = resend.Emails.send(params)
        logger.info(f"Welcome email sent to {user_email}: {email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send welcome email to {user_email}: {e}")
        return False
